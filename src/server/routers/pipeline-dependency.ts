import { z } from "zod";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import {
  addDependency,
  removeDependency,
  getUpstreams,
  getDownstreams,
  getUndeployedUpstreams,
  getDeployedDownstreams,
  getDependencyGraph,
} from "@/server/services/pipeline-dependency";

export const pipelineDependencyRouter = router({
  list: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getUpstreams(input.pipelineId);
    }),

  add: protectedProcedure
    .input(
      z.object({
        upstreamId: z.string(),
        downstreamId: z.string(),
        description: z.string().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipelineDependency.created", "PipelineDependency"))
    .mutation(async ({ input }) => {
      return addDependency(
        input.upstreamId,
        input.downstreamId,
        input.description,
      );
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipelineDependency.deleted", "PipelineDependency"))
    .mutation(async ({ input }) => {
      return removeDependency(input.id);
    }),

  listCandidates: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        environmentId: z.string(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.pipeline.findMany({
        where: {
          environmentId: input.environmentId,
          id: { not: input.pipelineId },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
    }),

  deployWarnings: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getUndeployedUpstreams(input.pipelineId);
    }),

  undeployWarnings: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getDeployedDownstreams(input.pipelineId);
    }),

  graph: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return getDependencyGraph(input.environmentId);
    }),

  /**
   * Deployment impact: downstream pipelines that depend on this one,
   * separated by whether they are currently deployed. Used by the deploy
   * dialog to show blast radius beyond just the affected node count.
   */
  deploymentImpact: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const downstreams = await getDownstreams(input.pipelineId);
      return {
        deployed: downstreams
          .filter((d) => !d.downstream.isDraft)
          .map((d) => ({
            id: d.downstream.id,
            name: d.downstream.name,
            deployedAt: d.downstream.deployedAt,
          })),
        draft: downstreams
          .filter((d) => d.downstream.isDraft)
          .map((d) => ({ id: d.downstream.id, name: d.downstream.name })),
        total: downstreams.length,
      };
    }),
});
