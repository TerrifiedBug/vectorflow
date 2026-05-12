import { bucketMsForMinutes } from "@/lib/chart-buckets";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { metricStore } from "@/server/services/metric-store";
import type { MetricSample } from "@/server/services/metric-store";
import { prisma } from "@/lib/prisma";
import { queryPipelineMetricsAggregated } from "@/server/services/metrics-query";
import { sourceBytesRate, sourceEventsRate } from "@/lib/metrics/component-rates";
import { isDemoMode } from "@/lib/is-demo-mode";


interface PipelineMetricChartRow {
  timestamp: Date;
  eventsIn: bigint;
  eventsOut: bigint;
  eventsDiscarded: bigint;
  errorsTotal: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  utilization: number;
  latencyMeanMs: number | null;
}

function toBigInt(value: bigint | number | null | undefined): bigint {
  return typeof value === "bigint" ? value : BigInt(Math.round(Number(value ?? 0)));
}


function downsamplePipelineMetricRows(
  rows: PipelineMetricChartRow[],
  bucketMs: number,
): PipelineMetricChartRow[] {
  const buckets = new Map<number, {
    count: number;
    eventsIn: bigint;
    eventsOut: bigint;
    eventsDiscarded: bigint;
    errorsTotal: bigint;
    bytesIn: bigint;
    bytesOut: bigint;
    utilization: number;
    latencyMeanMs: number;
    latencyCount: number;
  }>();

  for (const row of rows) {
    const bucket = Math.floor(row.timestamp.getTime() / bucketMs) * bucketMs;
    const acc = buckets.get(bucket) ?? {
      count: 0,
      eventsIn: BigInt(0),
      eventsOut: BigInt(0),
      eventsDiscarded: BigInt(0),
      errorsTotal: BigInt(0),
      bytesIn: BigInt(0),
      bytesOut: BigInt(0),
      utilization: 0,
      latencyMeanMs: 0,
      latencyCount: 0,
    };

    acc.count++;
    acc.eventsIn += toBigInt(row.eventsIn);
    acc.eventsOut += toBigInt(row.eventsOut);
    acc.eventsDiscarded += toBigInt(row.eventsDiscarded);
    acc.errorsTotal += toBigInt(row.errorsTotal);
    acc.bytesIn += toBigInt(row.bytesIn);
    acc.bytesOut += toBigInt(row.bytesOut);
    acc.utilization += Number(row.utilization ?? 0);
    if (row.latencyMeanMs != null) {
      acc.latencyMeanMs += row.latencyMeanMs;
      acc.latencyCount++;
    }
    buckets.set(bucket, acc);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, acc]) => ({
      timestamp: new Date(bucket),
      eventsIn: acc.eventsIn,
      eventsOut: acc.eventsOut,
      eventsDiscarded: acc.eventsDiscarded,
      errorsTotal: acc.errorsTotal,
      bytesIn: acc.bytesIn,
      bytesOut: acc.bytesOut,
      utilization: acc.utilization / acc.count,
      latencyMeanMs: acc.latencyCount > 0 ? acc.latencyMeanMs / acc.latencyCount : null,
    }));
}
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
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const result = await queryPipelineMetricsAggregated({
        pipelineId: input.pipelineId,
        minutes: input.minutes,
      });

      return {
        rows: downsamplePipelineMetricRows(result.rows, bucketMsForMinutes(input.minutes)),
      };
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
        take: 10000,
      });

      // Average across nodes per (componentId, timestamp) to handle multi-node deployments
      const components: Record<string, Array<{ timestamp: Date; latencyMeanMs: number }>> = {};
      const acc: Record<string, Map<number, { sum: number; count: number }>> = {};
      const bucketMs = bucketMsForMinutes(input.minutes);


      for (const row of rows) {
        if (!row.componentId || row.latencyMeanMs == null) continue;
        const tsMs = Math.floor(row.timestamp.getTime() / bucketMs) * bucketMs;
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
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      // Soft-fail for stale/deleted pipelines so the flow-editor overlay
      // tolerates a brief polling window after a delete.
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: {
          nodes: true,
          environment: { include: { nodes: true } },
        },
      });

      if (!pipeline) return { components: {} };

      // Inline auth: super admin bypasses; otherwise must be a member of the
      // pipeline's environment team.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      });
      if (!user?.isSuperAdmin) {
        const teamId = pipeline.environment.teamId;
        if (!teamId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const membership = await prisma.teamMember.findUnique({
          where: { userId_teamId: { userId, teamId } },
          select: { role: true },
        });
        if (!membership) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }

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

      // Demo-mode fallback: when no live metricStore samples are available
      // (no real agents pushing data), synthesise per-component samples from
      // the pipeline-level rows backfilled by the demo seed. This lets the
      // flow editor light up its node throughput overlays + nudge xyflow into
      // recomputing edge geometry on the first render — without it, edges
      // that load before ResizeObserver finishes measuring stay zero-length
      // until the user drags a node.
      if (Object.keys(components).length === 0 && isDemoMode() && pipeline.nodes.length > 0) {
        const since = new Date(Date.now() - input.minutes * 60 * 1000);
        const rows = await prisma.pipelineMetric.findMany({
          where: {
            pipelineId: input.pipelineId,
            nodeId: null,
            componentId: null,
            timestamp: { gte: since },
          },
          orderBy: { timestamp: "asc" },
          select: {
            timestamp: true,
            eventsIn: true,
            eventsOut: true,
            bytesIn: true,
            bytesOut: true,
            eventsDiscarded: true,
            errorsTotal: true,
            latencyMeanMs: true,
          },
        });

        if (rows.length > 0) {
          // PipelineMetric rows are per-5-minute counters — convert to rates.
          const INTERVAL_SECONDS = 300;
          const samples: MetricSample[] = rows.map((r) => ({
            timestamp: r.timestamp.getTime(),
            receivedEventsRate: Number(r.eventsIn) / INTERVAL_SECONDS,
            sentEventsRate: Number(r.eventsOut) / INTERVAL_SECONDS,
            receivedBytesRate: Number(r.bytesIn) / INTERVAL_SECONDS,
            sentBytesRate: Number(r.bytesOut) / INTERVAL_SECONDS,
            errorCount: Number(r.errorsTotal),
            errorsRate: Number(r.errorsTotal) / INTERVAL_SECONDS,
            discardedRate: Number(r.eventsDiscarded) / INTERVAL_SECONDS,
            latencyMeanMs: r.latencyMeanMs,
          }));

          // Apply the same series to every node in the pipeline. The
          // edge-overlay code in flow-store.updateNodeMetrics keys off
          // componentKey, so the kind-specific rates are picked downstream.
          for (const node of pipeline.nodes) {
            components[node.componentKey] = {
              componentKey: node.componentKey,
              displayName: node.displayName,
              componentType: node.componentType,
              kind: node.kind,
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
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      // Soft-fail for stale/deleted nodes so polling clients get a tolerable
      // empty payload instead of an error.
      const node = await prisma.vectorNode.findUnique({
        where: { id: input.nodeId },
        select: { environmentId: true },
      });
      if (!node) return { rates: {} };

      // Inline auth: super admin bypasses; otherwise must be a member of the
      // node's environment team.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      });
      if (!user?.isSuperAdmin) {
        const env = await prisma.environment.findUnique({
          where: { id: node.environmentId },
          select: { teamId: true },
        });
        const teamId = env?.teamId;
        if (!teamId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const membership = await prisma.teamMember.findUnique({
          where: { userId_teamId: { userId, teamId } },
          select: { role: true },
        });
        if (!membership) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }

      const nodeMetrics = metricStore.getAllForNode(input.nodeId, 5);

      // Map componentKey → { pipelineId, kind } using pipeline nodes
      const pipelineNodes = await prisma.pipelineNode.findMany({
        where: { pipeline: { environmentId: node.environmentId } },
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
          existing.eventsInRate += sourceEventsRate(latest);
          existing.bytesInRate += sourceBytesRate(latest);
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
              eventsPerSec += sourceEventsRate(latest);
              bytesPerSec += sourceBytesRate(latest);
            }
          }
        }

        rates[pipeline.id] = { eventsPerSec, bytesPerSec };
      }

      return { rates };
    }),
});
