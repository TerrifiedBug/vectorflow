import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { assertPipelineBatchAccess } from "@/server/authz";

export const pipelineBulkRouter = router({
  bulkDelete: protectedProcedure
    .input(
      z.object({
        pipelineIds: z.array(z.string()).min(1).max(50),
      }),
    )
    .use(withTeamAccess("ADMIN"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      await assertPipelineBatchAccess(input.pipelineIds, userId, "ADMIN");

      const results: Array<{ pipelineId: string; success: boolean; error?: string }> = [];

      for (const pipelineId of input.pipelineIds) {
        try {
          const pipeline = await prisma.pipeline.findUnique({
            where: { id: pipelineId },
            select: { id: true, isSystem: true, deployedAt: true, environmentId: true },
          });

          if (!pipeline) {
            results.push({ pipelineId, success: false, error: "Pipeline not found" });
            continue;
          }

          if (pipeline.isSystem) {
            results.push({ pipelineId, success: false, error: "Cannot delete system pipeline" });
            continue;
          }

          // Undeploy first if deployed
          if (pipeline.deployedAt) {
            await prisma.pipeline.update({
              where: { id: pipelineId },
              data: { isDraft: true, deployedAt: null },
            });
          }

          await prisma.pipeline.delete({ where: { id: pipelineId } });
          results.push({ pipelineId, success: true });
        } catch (err) {
          results.push({
            pipelineId,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return { results, total: results.length, succeeded: results.filter((r) => r.success).length };
    }),

  bulkAddTags: protectedProcedure
    .input(
      z.object({
        pipelineIds: z.array(z.string()).min(1).max(100),
        tags: z.array(z.string()).min(1),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const { teamId } = await assertPipelineBatchAccess(input.pipelineIds, userId, "EDITOR");

      // Validate tags against team.availableTags ONCE before the loop
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { availableTags: true },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      const availableTags = (team.availableTags as string[]) ?? [];
      if (availableTags.length > 0) {
        const invalid = input.tags.filter((t) => !availableTags.includes(t));
        if (invalid.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid tags: ${invalid.join(", ")}. Tags must be defined in team settings first.`,
          });
        }
      }

      const results: Array<{ pipelineId: string; success: boolean; error?: string }> = [];

      for (const pipelineId of input.pipelineIds) {
        try {
          const pipeline = await prisma.pipeline.findUnique({
            where: { id: pipelineId },
            select: { id: true, tags: true },
          });
          if (!pipeline) {
            results.push({ pipelineId, success: false, error: "Pipeline not found" });
            continue;
          }
          const existingTags = (pipeline.tags as string[]) ?? [];
          const merged = [...new Set([...existingTags, ...input.tags])];
          await prisma.pipeline.update({
            where: { id: pipelineId },
            data: { tags: merged },
          });
          results.push({ pipelineId, success: true });
        } catch (err) {
          results.push({
            pipelineId,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return { results, total: results.length, succeeded: results.filter((r) => r.success).length };
    }),

  bulkRemoveTags: protectedProcedure
    .input(
      z.object({
        pipelineIds: z.array(z.string()).min(1).max(100),
        tags: z.array(z.string()).min(1),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      await assertPipelineBatchAccess(input.pipelineIds, userId, "EDITOR");

      const results: Array<{ pipelineId: string; success: boolean; error?: string }> = [];

      for (const pipelineId of input.pipelineIds) {
        try {
          const pipeline = await prisma.pipeline.findUnique({
            where: { id: pipelineId },
            select: { id: true, tags: true },
          });
          if (!pipeline) {
            results.push({ pipelineId, success: false, error: "Pipeline not found" });
            continue;
          }
          const existingTags = (pipeline.tags as string[]) ?? [];
          const filtered = existingTags.filter((t) => !input.tags.includes(t));
          await prisma.pipeline.update({
            where: { id: pipelineId },
            data: { tags: filtered },
          });
          results.push({ pipelineId, success: true });
        } catch (err) {
          results.push({
            pipelineId,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return { results, total: results.length, succeeded: results.filter((r) => r.success).length };
    }),
});
