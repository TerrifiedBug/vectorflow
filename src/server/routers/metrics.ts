import { z } from "zod";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
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
          eventsDiscarded: true,
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
            (pn) => componentId === pn.componentKey,
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

  /**
   * Per-pipeline live rates for a specific node.
   * Used by the fleet node detail page to show rate columns.
   */
  getNodePipelineRates: protectedProcedure
    .input(z.object({ nodeId: z.string() }))
    .query(async ({ input }) => {
      const nodeMetrics = metricStore.getAllForNode(input.nodeId, 5);

      // Map componentKey → { pipelineId, kind } using pipeline nodes
      const pipelineNodes = await prisma.pipelineNode.findMany({
        select: { pipelineId: true, componentKey: true, kind: true },
      });

      const rates: Record<string, {
        eventsInRate: number;
        eventsOutRate: number;
        bytesInRate: number;
        bytesOutRate: number;
        errorsRate: number;
      }> = {};

      for (const [componentId, samples] of nodeMetrics) {
        if (samples.length === 0) continue;
        const latest = samples[samples.length - 1];
        const matchingNode = pipelineNodes.find(
          (pn) => componentId === pn.componentKey,
        );
        if (!matchingNode) continue;

        const existing = rates[matchingNode.pipelineId] ?? {
          eventsInRate: 0, eventsOutRate: 0,
          bytesInRate: 0, bytesOutRate: 0, errorsRate: 0,
        };
        if (matchingNode.kind === "SOURCE") {
          existing.eventsInRate += latest.receivedEventsRate;
          existing.bytesInRate += latest.receivedBytesRate;
        } else if (matchingNode.kind === "SINK") {
          existing.eventsOutRate += latest.sentEventsRate;
          existing.bytesOutRate += latest.sentBytesRate;
        }
        existing.errorsRate += latest.errorsRate;
        rates[matchingNode.pipelineId] = existing;
      }

      return { rates };
    }),

  /**
   * Per-pipeline live rates for the pipelines table.
   * Aggregates source component rates (events/sec, bytes/sec) per pipeline.
   */
  getLiveRates: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      // Fetch pipelines and environment nodes in parallel (nodes are shared across all pipelines)
      const [pipelines, envNodes] = await Promise.all([
        prisma.pipeline.findMany({
          where: { environmentId: input.environmentId },
          select: {
            id: true,
            nodes: { select: { componentKey: true, kind: true } },
          },
        }),
        prisma.vectorNode.findMany({
          where: { environmentId: input.environmentId },
          select: { id: true },
        }),
      ]);

      const vectorNodeIds = envNodes.map((n) => n.id);
      const rates: Record<string, { eventsPerSec: number; bytesPerSec: number }> = {};

      for (const pipeline of pipelines) {
        let eventsPerSec = 0;
        let bytesPerSec = 0;

        const sourceKeys = pipeline.nodes
          .filter((n) => n.kind === "SOURCE")
          .map((n) => n.componentKey);

        for (const vectorNodeId of vectorNodeIds) {
          const nodeMetrics = metricStore.getAllForNode(vectorNodeId, 5);
          for (const [componentId, samples] of nodeMetrics) {
            if (samples.length === 0) continue;
            const matchesSource = sourceKeys.some((key) => componentId === key);
            if (matchesSource) {
              const latest = samples[samples.length - 1];
              eventsPerSec += latest.receivedEventsRate;
              bytesPerSec += latest.receivedBytesRate;
            }
          }
        }

        rates[pipeline.id] = { eventsPerSec, bytesPerSec };
      }

      return { rates };
    }),
});
