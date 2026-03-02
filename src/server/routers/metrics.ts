import { z } from "zod";
import { router, protectedProcedure } from "@/trpc/init";
import { metricStore } from "@/server/services/metric-store";
import { prisma } from "@/lib/prisma";

export const metricsRouter = router({
  /**
   * Pipeline-level metrics from the database (persistent, per-minute rollups).
   * Used by the standalone metrics page and anywhere that needs historical data.
   */
  getPipelineMetrics: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        minutes: z.number().int().min(1).max(1440).default(60),
      }),
    )
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.minutes * 60 * 1000);

      const rows = await prisma.pipelineMetric.findMany({
        where: {
          pipelineId: input.pipelineId,
          nodeId: null,
          timestamp: { gte: since },
        },
        orderBy: { timestamp: "asc" },
        select: {
          timestamp: true,
          eventsIn: true,
          eventsOut: true,
          errorsTotal: true,
          bytesIn: true,
          bytesOut: true,
          utilization: true,
        },
      });

      return { rows };
    }),

  /**
   * Per-component live metrics from the in-memory store.
   * Used by the flow editor to overlay throughput on nodes.
   */
  getComponentMetrics: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        minutes: z.number().int().min(1).max(60).default(5),
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
