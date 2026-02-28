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

export const middleware = t.middleware;

export { roleLevel };
