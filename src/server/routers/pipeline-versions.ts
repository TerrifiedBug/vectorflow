import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import {
  createVersion,
  listVersions,
  listVersionsSummary,
  getVersion,
  rollback,
} from "@/server/services/pipeline-version";
import { relayPush } from "@/server/services/push-broadcast";
import { broadcastSSE } from "@/server/services/sse-broadcast";
import { fireEventAlert } from "@/server/services/event-alerts";

export const pipelineVersionsRouter = router({
  versions: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return listVersions(input.pipelineId);
    }),

  versionsSummary: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return listVersionsSummary(input.pipelineId);
    }),

  createVersion: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        configYaml: z.string().min(1),
        changelog: z.string().optional(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: { globalConfig: true, nodes: true, edges: true },
      });
      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }
      const logLevel = (pipeline.globalConfig as Record<string, unknown>)?.log_level as string ?? null;

      const nodesSnapshot = pipeline.nodes.map((n) => ({
        id: n.id,
        componentKey: n.componentKey,
        displayName: n.displayName,
        componentType: n.componentType,
        kind: n.kind,
        config: n.config,
        positionX: n.positionX,
        positionY: n.positionY,
        disabled: n.disabled,
        sharedComponentId: n.sharedComponentId ?? null,
        sharedComponentVersion: n.sharedComponentVersion ?? null,
      }));
      const edgesSnapshot = pipeline.edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourcePort: e.sourcePort,
      }));

      return createVersion(
        input.pipelineId,
        input.configYaml,
        userId,
        input.changelog,
        logLevel,
        pipeline.globalConfig as Record<string, unknown> | null,
        nodesSnapshot,
        edgesSnapshot,
      );
    }),

  getVersion: protectedProcedure
    .input(z.object({ versionId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getVersion(input.versionId);
    }),

  rollback: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        targetVersionId: z.string(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.rollback", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const version = await rollback(input.pipelineId, input.targetVersionId, userId);

      // Notify connected agents and browsers about the rollback (non-fatal side effect)
      try {
        const pipeline = await prisma.pipeline.findUnique({
          where: { id: input.pipelineId },
          select: { name: true, environmentId: true, nodeSelector: true },
        });
        if (pipeline) {
          const nodeSelector = pipeline.nodeSelector as Record<string, string> | null;
          const targetNodes = await prisma.vectorNode.findMany({
            where: { environmentId: pipeline.environmentId },
            select: { id: true, labels: true },
          });
          for (const node of targetNodes) {
            const labels = (node.labels as Record<string, string>) ?? {};
            const selectorEntries = Object.entries(nodeSelector ?? {});
            const matches = selectorEntries.every(([k, v]) => labels[k] === v);
            if (matches) {
              relayPush(node.id, {
                type: "config_changed",
                pipelineId: input.pipelineId,
                reason: "rollback",
              });
            }
          }

          broadcastSSE({
            type: "status_change",
            nodeId: "",
            fromStatus: "",
            toStatus: "DEPLOYED",
            reason: "rollback",
            pipelineId: input.pipelineId,
            pipelineName: pipeline.name,
          }, pipeline.environmentId);

          void fireEventAlert("deploy_completed", pipeline.environmentId, {
            message: `Pipeline "${pipeline.name}" rolled back`,
            pipelineId: input.pipelineId,
          });
        }
      } catch (err) {
        console.error("[rollback] Push/SSE notification failed:", err);
      }

      return version;
    }),
});
