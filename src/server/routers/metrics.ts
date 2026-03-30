import { z } from "zod";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { metricStore } from "@/server/services/metric-store";
import { prisma } from "@/lib/prisma";
import { queryPipelineMetricsAggregated } from "@/server/services/metrics-query";

export const metricsRouter = router({
  /**
   * Pipeline-level metrics from the database (persistent, per-minute rollups).
   * Used by the standalone metrics page and anywhere that needs historical data.
   */
  getPipelineMetrics: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        minutes: z.number().int().min(1).max(10080).default(60), // max 7 days (was 1440)
      }),
    )
    .query(async ({ input }) => {
      return queryPipelineMetricsAggregated({
        pipelineId: input.pipelineId,
        minutes: input.minutes,
      });
    }),

  /**
   * Per-component historical latency from the database.
   * Used by the pipeline metrics page for the multi-line transform latency chart.
   */
  getComponentLatencyHistory: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        minutes: z.number().int().min(1).max(1440).default(60),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.minutes * 60 * 1000);

      const rows = await prisma.pipelineMetric.findMany({
        where: {
          pipelineId: input.pipelineId,
          componentId: { not: null },
          timestamp: { gte: since },
        },
        orderBy: { timestamp: "asc" },
        select: {
          componentId: true,
          timestamp: true,
          latencyMeanMs: true,
        },
      });

      // Average across nodes per (componentId, timestamp) to handle multi-node deployments
      const components: Record<string, Array<{ timestamp: Date; latencyMeanMs: number }>> = {};
      const acc: Record<string, Map<number, { sum: number; count: number }>> = {};

      for (const row of rows) {
        if (!row.componentId || row.latencyMeanMs == null) continue;
        const tsMs = row.timestamp.getTime();
        const byTs = acc[row.componentId] ?? new Map();
        const bucket = byTs.get(tsMs) ?? { sum: 0, count: 0 };
        bucket.sum += row.latencyMeanMs;
        bucket.count++;
        byTs.set(tsMs, bucket);
        acc[row.componentId] = byTs;
      }

      for (const [cid, byTs] of Object.entries(acc)) {
        components[cid] = Array.from(byTs.entries())
          .map(([tsMs, { sum, count }]) => ({
            timestamp: new Date(tsMs),
            latencyMeanMs: sum / count,
          }))
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      }

      return { components };
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
        displayName: string | null;
        componentType: string;
        kind: string;
        samples: ReturnType<typeof metricStore.getSamples>;
      }> = {};

      for (const vectorNode of vectorNodes) {
        const nodeMetrics = metricStore.getAllForPipeline(vectorNode.id, input.pipelineId, input.minutes);
        for (const [componentId, samples] of nodeMetrics) {
          const matchingNode = pipeline.nodes.find(
            (pn) => componentId === pn.componentKey,
          );
          if (matchingNode) {
            components[componentId] = {
              componentKey: matchingNode.componentKey,
              displayName: matchingNode.displayName,
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
        select: { pipelineId: true, componentKey: true, displayName: true, kind: true },
      });

      const rates: Record<string, {
        eventsInRate: number;
        eventsOutRate: number;
        bytesInRate: number;
        bytesOutRate: number;
        errorsRate: number;
        latencyMeanMs: number | null;
      }> = {};
      // Accumulate latency sum+count for proper averaging across components
      const latencyAcc: Record<string, { sum: number; count: number }> = {};

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
          latencyMeanMs: null,
        };
        if (matchingNode.kind === "SOURCE") {
          existing.eventsInRate += latest.receivedEventsRate;
          existing.bytesInRate += latest.receivedBytesRate;
        } else if (matchingNode.kind === "SINK") {
          existing.eventsOutRate += latest.sentEventsRate;
          existing.bytesOutRate += latest.sentBytesRate;
        }
        existing.errorsRate += latest.errorsRate;
        if (latest.latencyMeanMs != null) {
          const acc = latencyAcc[matchingNode.pipelineId] ?? { sum: 0, count: 0 };
          acc.sum += latest.latencyMeanMs;
          acc.count++;
          latencyAcc[matchingNode.pipelineId] = acc;
        }
        rates[matchingNode.pipelineId] = existing;
      }

      // Compute proper mean latency per pipeline
      for (const [pipelineId, acc] of Object.entries(latencyAcc)) {
        if (rates[pipelineId] && acc.count > 0) {
          rates[pipelineId].latencyMeanMs = acc.sum / acc.count;
        }
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
          const pipelineMetrics = metricStore.getAllForPipeline(vectorNodeId, pipeline.id, 5);
          for (const [componentId, samples] of pipelineMetrics) {
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
