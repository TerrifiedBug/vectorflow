import { z } from "zod";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { withOrgTx } from "@/lib/with-org-tx";
import { withAudit } from "@/server/middleware/audit";
import { saveGraphComponents, discardPipelineChanges } from "@/server/services/pipeline-graph";
import { nodeSchema, edgeSchema } from "./pipeline-schemas";

export const pipelineGraphRouter = router({
  saveGraph: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        nodes: z.array(nodeSchema),
        edges: z.array(edgeSchema),
        globalConfig: z.record(z.string().max(128).regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/), z.any()).nullable().optional(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.graph_saved", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      // Set audit metadata summary — this side-effect MUST stay in the router
      const nodeTypes = input.nodes.map((n) => `${n.kind.toLowerCase()}:${n.componentType}`);
      (ctx as Record<string, unknown>).auditMetadata = {
        pipelineId: input.pipelineId,
        nodeCount: input.nodes.length,
        edgeCount: input.edges.length,
        nodeTypes: [...new Set(nodeTypes)],
      };

      return withOrgTx(ctx.organizationId, async (tx) => {
        return saveGraphComponents(tx, {
          pipelineId: input.pipelineId,
          nodes: input.nodes,
          edges: input.edges,
          globalConfig: input.globalConfig,
          userId: ctx.session.user?.id ?? null,
        });
      });
    }),

  discardChanges: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.changes_discarded", "Pipeline"))
    .mutation(async ({ input }) => {
      return discardPipelineChanges(input.pipelineId);
    }),
});
