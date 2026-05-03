import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { undeployAgent } from "@/server/services/deploy-agent";
import { assertPipelineBatchAccess } from "@/server/authz";

export const pipelineDeployRouter = router({
  deploymentStatus: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { version: true },
          },
        },
      });

      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      const latestVersion = pipeline.versions[0]?.version ?? 0;

      const statuses = await prisma.nodePipelineStatus.findMany({
        where: { pipelineId: input.pipelineId },
        include: {
          node: {
            select: {
              id: true,
              name: true,
              host: true,
              status: true,
              lastHeartbeat: true,
            },
          },
        },
      });

      return {
        latestVersion,
        deployed: !pipeline.isDraft,
        nodes: statuses.map((s) => ({
          nodeId: s.node.id,
          nodeName: s.node.name,
          nodeHost: s.node.host,
          nodeStatus: s.node.status,
          pipelineStatus: s.status,
          runningVersion: s.version,
          isLatest: s.version === latestVersion,
          uptimeSeconds: s.uptimeSeconds,
          lastUpdated: s.lastUpdated,
        })),
      };
    }),

  deployBatch: protectedProcedure
    .input(
      z.object({
        pipelineIds: z.array(z.string()).min(1).max(200),
        changelog: z.string().min(1),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.batch_deployed", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      await assertPipelineBatchAccess(input.pipelineIds, userId, "EDITOR");

      const { deployBatch: deployBatchFn } = await import(
        "@/server/services/deploy-agent"
      );
      return deployBatchFn(input.pipelineIds, userId, input.changelog);
    }),

  bulkUndeploy: protectedProcedure
    .input(
      z.object({
        pipelineIds: z.array(z.string()).min(1).max(50),
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
          const result = await undeployAgent(pipelineId);
          results.push({ pipelineId, success: result.success, error: result.error });
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
