import { z } from "zod";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { VRL_SNIPPETS } from "@/lib/vrl/snippets";
import { withAudit } from "@/server/middleware/audit";

export const vrlSnippetRouter = router({
  list: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const custom = await prisma.vrlSnippet.findMany({
        where: { teamId: input.teamId },
        orderBy: { name: "asc" },
      });
      return {
        builtIn: VRL_SNIPPETS,
        custom: custom.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? "",
          category: s.category,
          code: s.code,
          isCustom: true as const,
        })),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        category: z.string().min(1).max(50),
        code: z.string().min(1),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("vrlSnippet.created", "VrlSnippet"))
    .mutation(async ({ input, ctx }) => {
      return prisma.vrlSnippet.create({
        data: {
          teamId: input.teamId,
          name: input.name,
          description: input.description,
          category: input.category,
          code: input.code,
          createdBy: ctx.session.user!.id!,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        category: z.string().min(1).max(50).optional(),
        code: z.string().min(1).optional(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("vrlSnippet.updated", "VrlSnippet"))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return prisma.vrlSnippet.update({ where: { id }, data });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("vrlSnippet.deleted", "VrlSnippet"))
    .mutation(async ({ input }) => {
      return prisma.vrlSnippet.delete({ where: { id: input.id } });
    }),
});
