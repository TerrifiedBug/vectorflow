import { z } from "zod";
import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";

export const userPreferenceRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const prefs = await prisma.userPreference.findMany({
      where: { userId: ctx.session.user!.id! },
    });
    return Object.fromEntries(prefs.map((p) => [p.key, p.value]));
  }),

  set: protectedProcedure
    .input(z.object({ key: z.string().max(100), value: z.string().max(500) }))
    .mutation(async ({ ctx, input }) => {
      await prisma.userPreference.upsert({
        where: {
          userId_key: { userId: ctx.session.user!.id!, key: input.key },
        },
        create: { userId: ctx.session.user!.id!, key: input.key, value: input.value },
        update: { value: input.value },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ key: z.string().max(100) }))
    .mutation(async ({ ctx, input }) => {
      await prisma.userPreference.deleteMany({
        where: { userId: ctx.session.user!.id!, key: input.key },
      });
    }),
});
