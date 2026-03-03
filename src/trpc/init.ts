import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma";

export const createContext = async () => {
  const session = await auth();
  let ipAddress: string | null = null;
  try {
    const hdrs = await headers();
    ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()
      || hdrs.get("x-real-ip")
      || null;
  } catch {
    // headers() may fail outside request context
  }
  return { session, ipAddress };
};

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { session: ctx.session },
  });
});

const roleLevel: Record<Role, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
};

export const requireRole = (minRole: Role) =>
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // Get the user's highest role across all team memberships
    const memberships = await prisma.teamMember.findMany({
      where: { userId },
      select: { role: true },
    });

    if (memberships.length === 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of any team",
      });
    }

    const highestRole = memberships.reduce<Role>((best, m) =>
      roleLevel[m.role] > roleLevel[best] ? m.role : best,
      memberships[0].role,
    );

    if (roleLevel[highestRole] < roleLevel[minRole]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This action requires ${minRole} role or higher`,
      });
    }

    return next({
      ctx: { session: ctx.session, userRole: highestRole },
    });
  });

export const requireSuperAdmin = () =>
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });

    if (!user?.isSuperAdmin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This action requires super admin access",
      });
    }

    return next({
      ctx: { session: ctx.session, userRole: "ADMIN" as Role },
    });
  });

/**
 * Team-scoped authorization middleware.
 * Resolves teamId from procedure input, validates membership, checks role.
 * Super admins bypass the membership check.
 */
export const withTeamAccess = (minRole: Role) =>
  t.middleware(async ({ ctx, getRawInput, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const rawInput = (await getRawInput()) as Record<string, unknown> | undefined;

    // Resolve teamId: directly from input, or via environmentId/pipelineId lookup
    let teamId: string | undefined = rawInput?.teamId as string | undefined;

    if (!teamId && rawInput?.environmentId) {
      const env = await prisma.environment.findUnique({
        where: { id: rawInput.environmentId as string },
        select: { teamId: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }
      teamId = env.teamId ?? undefined;
    }

    if (!teamId && rawInput?.pipelineId) {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: rawInput.pipelineId as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }
      teamId = pipeline.environment.teamId ?? undefined;
    }

    // Fallback: try input.id as various entity types
    if (!teamId && rawInput?.id) {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (pipeline) {
        teamId = pipeline.environment.teamId ?? undefined;
      }
    }

    if (!teamId && rawInput?.id) {
      const env = await prisma.environment.findUnique({
        where: { id: rawInput.id as string },
        select: { teamId: true },
      });
      if (env) {
        teamId = env.teamId ?? undefined;
      }
    }

    if (!teamId && rawInput?.id) {
      const node = await prisma.vectorNode.findUnique({
        where: { id: rawInput.id as string },
        select: { environment: { select: { teamId: true } } },
      });
      if (node) {
        teamId = node.environment.teamId ?? undefined;
      }
    }

    if (!teamId && rawInput?.id) {
      const template = await prisma.template.findUnique({
        where: { id: rawInput.id as string },
        select: { teamId: true },
      });
      if (template?.teamId) {
        teamId = template.teamId;
      }
    }

    if (!teamId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot resolve team context from input",
      });
    }

    // Super admins bypass membership check
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });

    if (user?.isSuperAdmin) {
      return next({
        ctx: { session: ctx.session, teamId, userRole: "ADMIN" as Role },
      });
    }

    // Check membership and role in this specific team
    const membership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    });

    if (!membership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of this team",
      });
    }

    if (roleLevel[membership.role] < roleLevel[minRole]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This action requires ${minRole} role or higher in this team`,
      });
    }

    return next({
      ctx: { session: ctx.session, teamId, userRole: membership.role },
    });
  });

export const middleware = t.middleware;

export { roleLevel };
