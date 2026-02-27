import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { auth } from "@/auth";
import type { Role } from "@/generated/prisma";

export const createContext = async () => {
  const session = await auth();
  return { session };
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
    return next({ ctx: { session: ctx.session } });
  });

export { roleLevel };
