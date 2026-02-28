import { z } from "zod";
import { router, protectedProcedure } from "@/trpc/init";
import { metricStore } from "@/server/services/metric-store";
import { prisma } from "@/lib/prisma";

export const metricsRouter = router({
  getComponentMetrics: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        componentId: z.string(),
        minutes: z.number().int().min(1).max(60).default(60),
      }),
    )
    .query(({ input }) => {
      return metricStore.getSamples(input.nodeId, input.componentId, input.minutes);
    }),

  getNodeMetrics: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        minutes: z.number().int().min(1).max(60).default(60),
      }),
    )
    .query(({ input }) => {
      const allMetrics = metricStore.getAllForNode(input.nodeId, input.minutes);
      const result: Record<string, { samples: ReturnType<typeof metricStore.getSamples> }> = {};
      for (const [componentId, samples] of allMetrics) {
        result[componentId] = { samples };
      }
      return result;
    }),

  getPipelineMetrics: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        minutes: z.number().int().min(1).max(60).default(60),
      }),
    )
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: {
          nodes: true,
          environment: { include: { nodes: true } },
        },
      });

      if (!pipeline) return { components: {} };

      const vectorNodes = pipeline.environment.nodes;

      const components: Record<string, {
        componentKey: string;
        componentType: string;
        kind: string;
        samples: ReturnType<typeof metricStore.getSamples>;
      }> = {};

      for (const vectorNode of vectorNodes) {
        const nodeMetrics = metricStore.getAllForNode(vectorNode.id, input.minutes);
        for (const [componentId, samples] of nodeMetrics) {
          const matchingNode = pipeline.nodes.find(
            (pn) => componentId.includes(pn.componentKey),
          );
          if (matchingNode) {
            components[componentId] = {
              componentKey: matchingNode.componentKey,
              componentType: matchingNode.componentType,
              kind: matchingNode.kind,
              samples,
            };
          }
        }
      }

      return { components };
    }),
});
