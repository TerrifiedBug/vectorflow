import { z } from "zod";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import {
  addDependency,
  removeDependency,
  getUpstreams,
  getUndeployedUpstreams,
  getDeployedDownstreams,
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
});
