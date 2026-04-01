import { Registry, Gauge } from "prom-client";
import { prisma } from "@/lib/prisma";
import { metricStore } from "@/server/services/metric-store";
import { errorLog } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert BigInt to number, saturating at MAX_SAFE_INTEGER. */
export function bigIntToNumber(val: bigint): number {
  if (val > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  if (val < BigInt(Number.MIN_SAFE_INTEGER)) return Number.MIN_SAFE_INTEGER;
  return Number(val);
}

// ---------------------------------------------------------------------------
// PrometheusMetricsService
// ---------------------------------------------------------------------------

export class PrometheusMetricsService {
  private registry: Registry;

  // Node-level gauges
  private nodeStatus: Gauge;

  // Pipeline-level gauges (from NodePipelineStatus)
  private pipelineStatus: Gauge;
  private pipelineEventsIn: Gauge;
  private pipelineEventsOut: Gauge;
  private pipelineErrorsTotal: Gauge;
  private pipelineEventsDiscarded: Gauge;
  private pipelineBytesIn: Gauge;
  private pipelineBytesOut: Gauge;
  private pipelineUtilization: Gauge;

  // PipelineMetric-level gauges (latest snapshot)
  private pipelineLatencyMean: Gauge;

  // MetricStore gauges
  private metricStoreStreams: Gauge;
  private metricStoreMemoryBytes: Gauge;

  constructor(registry?: Registry) {
    this.registry = registry ?? new Registry();

    this.nodeStatus = new Gauge({
      name: "vectorflow_node_status",
      help: "Node status (1=HEALTHY, 2=DEGRADED, 3=UNREACHABLE, 0=UNKNOWN)",
      labelNames: ["node_id", "node_name", "environment_id"],
      registers: [this.registry],
    });

    this.pipelineStatus = new Gauge({
      name: "vectorflow_pipeline_status",
      help: "Pipeline process status (1=RUNNING, 2=STARTING, 3=STOPPED, 4=CRASHED, 0=PENDING)",
      labelNames: ["node_id", "pipeline_id"],
      registers: [this.registry],
    });

    this.pipelineEventsIn = new Gauge({
      name: "vectorflow_pipeline_events_in_total",
      help: "Total events received by the pipeline",
      labelNames: ["node_id", "pipeline_id"],
      registers: [this.registry],
    });

    this.pipelineEventsOut = new Gauge({
      name: "vectorflow_pipeline_events_out_total",
      help: "Total events sent by the pipeline",
      labelNames: ["node_id", "pipeline_id"],
      registers: [this.registry],
    });

    this.pipelineErrorsTotal = new Gauge({
      name: "vectorflow_pipeline_errors_total",
      help: "Total errors in the pipeline",
      labelNames: ["node_id", "pipeline_id"],
      registers: [this.registry],
    });

    this.pipelineEventsDiscarded = new Gauge({
      name: "vectorflow_pipeline_events_discarded_total",
      help: "Total events discarded by the pipeline",
      labelNames: ["node_id", "pipeline_id"],
      registers: [this.registry],
    });

    this.pipelineBytesIn = new Gauge({
      name: "vectorflow_pipeline_bytes_in_total",
      help: "Total bytes received by the pipeline",
      labelNames: ["node_id", "pipeline_id"],
      registers: [this.registry],
    });

    this.pipelineBytesOut = new Gauge({
      name: "vectorflow_pipeline_bytes_out_total",
      help: "Total bytes sent by the pipeline",
      labelNames: ["node_id", "pipeline_id"],
      registers: [this.registry],
    });

    this.pipelineUtilization = new Gauge({
      name: "vectorflow_pipeline_utilization",
      help: "Pipeline utilization (0.0–1.0)",
      labelNames: ["node_id", "pipeline_id"],
      registers: [this.registry],
    });

    this.pipelineLatencyMean = new Gauge({
      name: "vectorflow_pipeline_latency_mean_ms",
      help: "Mean pipeline latency in milliseconds (from latest PipelineMetric snapshot)",
      labelNames: ["pipeline_id", "node_id"],
      registers: [this.registry],
    });

    this.metricStoreStreams = new Gauge({
      name: "vectorflow_metric_store_streams",
      help: "Number of active metric streams in the in-memory MetricStore",
      registers: [this.registry],
    });

    this.metricStoreMemoryBytes = new Gauge({
      name: "vectorflow_metric_store_memory_bytes",
      help: "Estimated memory usage of the in-memory MetricStore in bytes",
      registers: [this.registry],
    });
  }

  /** The prom-client Registry for this service. */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Collect all metrics from database tables and populate the registry.
   * Resets all gauges first so removed nodes/pipelines disappear.
   */
  async collectMetrics(): Promise<string> {
    try {
      // Reset all gauges so stale labels are cleared
      this.nodeStatus.reset();
      this.pipelineStatus.reset();
      this.pipelineEventsIn.reset();
      this.pipelineEventsOut.reset();
      this.pipelineErrorsTotal.reset();
      this.pipelineEventsDiscarded.reset();
      this.pipelineBytesIn.reset();
      this.pipelineBytesOut.reset();
      this.pipelineUtilization.reset();
      this.pipelineLatencyMean.reset();

      // Run all 3 queries in parallel
      const [nodes, pipelineStatuses, latestMetrics] = await Promise.all([
        prisma.vectorNode.findMany({
          select: {
            id: true,
            name: true,
            environmentId: true,
            status: true,
          },
        }),
        prisma.nodePipelineStatus.findMany({
          select: {
            nodeId: true,
            pipelineId: true,
            status: true,
            eventsIn: true,
            eventsOut: true,
            errorsTotal: true,
            eventsDiscarded: true,
            bytesIn: true,
            bytesOut: true,
            utilization: true,
          },
        }),
        // Get the latest PipelineMetric per (pipelineId, nodeId) for latency
        prisma.$queryRaw<
          Array<{
            pipelineId: string;
            nodeId: string | null;
            latencyMeanMs: number | null;
          }>
        >`
          SELECT DISTINCT ON ("pipelineId", "nodeId")
            "pipelineId", "nodeId", "latencyMeanMs"
          FROM "PipelineMetric"
          WHERE "componentId" IS NULL
          ORDER BY "pipelineId", "nodeId", "timestamp" DESC
        `,
      ]);

      // Populate node status gauges
      const nodeStatusMap: Record<string, number> = {
        HEALTHY: 1,
        DEGRADED: 2,
        UNREACHABLE: 3,
        UNKNOWN: 0,
      };
      for (const node of nodes) {
        this.nodeStatus.set(
          {
            node_id: node.id,
            node_name: node.name,
            environment_id: node.environmentId,
          },
          nodeStatusMap[node.status] ?? 0,
        );
      }

      // Populate pipeline status gauges
      const processStatusMap: Record<string, number> = {
        RUNNING: 1,
        STARTING: 2,
        STOPPED: 3,
        CRASHED: 4,
        PENDING: 0,
      };
      for (const ps of pipelineStatuses) {
        const labels = { node_id: ps.nodeId, pipeline_id: ps.pipelineId };
        this.pipelineStatus.set(labels, processStatusMap[ps.status] ?? 0);
        this.pipelineEventsIn.set(labels, bigIntToNumber(ps.eventsIn));
        this.pipelineEventsOut.set(labels, bigIntToNumber(ps.eventsOut));
        this.pipelineErrorsTotal.set(labels, bigIntToNumber(ps.errorsTotal));
        this.pipelineEventsDiscarded.set(
          labels,
          bigIntToNumber(ps.eventsDiscarded),
        );
        this.pipelineBytesIn.set(labels, bigIntToNumber(ps.bytesIn));
        this.pipelineBytesOut.set(labels, bigIntToNumber(ps.bytesOut));
        this.pipelineUtilization.set(labels, ps.utilization);
      }

      // Populate latency gauges (only when latencyMeanMs is non-null)
      for (const m of latestMetrics) {
        if (m.latencyMeanMs != null) {
          this.pipelineLatencyMean.set(
            {
              pipeline_id: m.pipelineId,
              node_id: m.nodeId ?? "",
            },
            m.latencyMeanMs,
          );
        }
      }

      // MetricStore gauges
      this.metricStoreStreams.set(metricStore.getStreamCount());
      this.metricStoreMemoryBytes.set(metricStore.getEstimatedMemoryBytes());

      return await this.registry.metrics();
    } catch (error) {
      errorLog("prometheus-metrics", "collectMetrics failed", error);
      // Return whatever is in the registry (stale or empty)
      return await this.registry.metrics();
    }
  }
}
