import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/server/services/agent-auth";
import { checkNodeHealth } from "@/server/services/fleet-health";
import { ingestMetrics } from "@/server/services/metrics-ingest";
import { ingestLogs } from "@/server/services/log-ingest";
import { cleanupOldMetrics } from "@/server/services/metrics-cleanup";
import { metricStore } from "@/server/services/metric-store";
import { broadcastSSE, broadcastMetrics } from "@/server/services/sse-broadcast";
import type { FleetStatusEvent, LogEntryEvent, StatusChangeEvent } from "@/lib/sse/types";
import { isLeader } from "@/server/services/leader-election";
import { batchUpsertPipelineStatuses } from "@/server/services/heartbeat-batch";
import { DeploymentMode } from "@/generated/prisma";
import { isVersionOlder } from "@/lib/version";
import { checkTokenRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { warnLog, errorLog } from "@/lib/logger";
import {
  heartbeatRequestSchema,
  type PipelineStatusPayload,
  type SampleResultPayload,
} from "../../../../../contracts/agent/v1/payloads";

/** Compute pipeline-level weighted mean latency (ms) from per-component metrics. */
function computeWeightedLatency(
  components?: Array<{ receivedEvents: number; sentEvents: number; latencyMeanSeconds?: number }>,
): number | null {
  if (!components || components.length === 0) return null;
  let weightedSum = 0;
  let totalEvents = 0;
  for (const cm of components) {
    if (cm.latencyMeanSeconds == null || cm.latencyMeanSeconds === 0) continue;
    const events = cm.receivedEvents + cm.sentEvents;
    weightedSum += cm.latencyMeanSeconds * 1000 * events; // convert seconds → ms
    totalEvents += events;
  }
  if (totalEvents === 0) return null;
  return weightedSum / totalEvents;
}

let lastCleanup = 0;

async function processSampleResults(
  results: SampleResultPayload[],
  nodeId: string,
  environmentId: string,
): Promise<void> {
  for (const result of results) {
    if (!result.requestId) continue;
    const request = await prisma.eventSampleRequest.findUnique({
      where: { id: result.requestId },
      select: {
        pipelineId: true,
        status: true,
        nodeId: true,
        componentKeys: true,
        pipeline: { select: { environmentId: true } },
      },
    });
    if (!request || request.status !== "PENDING") continue;
    if (request.pipeline.environmentId !== environmentId) continue;
    if (
      result.componentKey &&
      Array.isArray(request.componentKeys) &&
      !request.componentKeys.includes(result.componentKey)
    ) {
      continue;
    }
    // Atomically claim the request: succeeds when nodeId is null (fan-out
    // path — no local SSE was confirmed at request time) or already bound
    // to this agent. Mirrors the samples-route claim semantics so heartbeat
    // results from a Redis fan-out winner are no longer dropped.
    const claim = await prisma.eventSampleRequest.updateMany({
      where: {
        id: result.requestId,
        status: "PENDING",
        OR: [{ nodeId: null }, { nodeId: nodeId }],
      },
      data: { nodeId },
    });
    if (claim.count === 0) continue;

    try {
      await prisma.eventSample.create({
        data: {
          requestId: result.requestId,
          pipelineId: request.pipelineId,
          componentKey: result.componentKey ?? "",
          events: (result.events ?? []) as Prisma.InputJsonValue,
          schema: (result.schema ?? []) as Prisma.InputJsonValue,
          error: result.error ?? null,
        },
      });

      await prisma.eventSampleRequest.update({
        where: { id: result.requestId },
        data: {
          status: result.error ? "ERROR" : "COMPLETED",
          completedAt: new Date(),
          nodeId,
        },
      });
    } catch (err) {
      // Only mark as ERROR if the EventSample write itself failed.
      // If another agent already submitted a successful result, the
      // request may already be COMPLETED — avoid overwriting that.
      const current = await prisma.eventSampleRequest.findUnique({
        where: { id: result.requestId },
        select: { status: true },
      });
      if (current && current.status === "PENDING") {
        await prisma.eventSampleRequest.update({
          where: { id: result.requestId },
          data: {
            status: "ERROR",
            completedAt: new Date(),
            nodeId,
          },
        });
      }
      errorLog("agent-heartbeat", "EventSample write error", err);
    }
  }
}


export async function POST(request: Request) {
  const rateLimited = checkTokenRateLimit(request, "heartbeat", 30);
  if (rateLimited) return rateLimited;

  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = heartbeatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { pipelines: rawPipelines, hostMetrics, agentVersion, vectorVersion, deploymentMode, updateError, runningAs } = parsed.data;

    // Validate pipeline ownership: only accept pipelines belonging to this agent's environment
    const validPipelines = await prisma.pipeline.findMany({
      where: { environmentId: agent.environmentId },
      select: { id: true, name: true },
    });
    const validPipelineIds = new Set(validPipelines.map((p) => p.id));
    const pipelineNameMap = new Map(validPipelines.map((p) => [p.id, p.name]));
    const pipelines = rawPipelines.filter((p) => validPipelineIds.has(p.pipelineId)) as PipelineStatusPayload[];

    const now = new Date();

    // Check if pendingAction should be cleared
    let clearPendingAction = false;
    if (updateError) {
      // Agent reported update failure — clear to stop retry loop
      clearPendingAction = true;
      warnLog("agent-heartbeat", `Agent update failed, clearing pending action: ${agent.nodeId}`, updateError);
    } else if (agentVersion) {
      const currentNode = await prisma.vectorNode.findUnique({
        where: { id: agent.nodeId },
        select: { pendingAction: true },
      });
      if (currentNode?.pendingAction) {
        const action = currentNode.pendingAction as { type: string; targetVersion?: string };
        if (
          action.type === "self_update" &&
          action.targetVersion &&
          !isVersionOlder(agentVersion, action.targetVersion)
        ) {
          clearPendingAction = true;
        }
      }
    }

    // Fetch current status before update so we can record a transition event
    const prevNode = await prisma.vectorNode.findUnique({
      where: { id: agent.nodeId },
      select: { status: true },
    });

    // Update node heartbeat and metadata
    const node = await prisma.vectorNode.update({
      where: { id: agent.nodeId },
      data: {
        lastHeartbeat: now,
        lastSeen: now,
        status: "HEALTHY",
        ...(agentVersion ? { agentVersion } : {}),
        ...(vectorVersion ? { vectorVersion } : {}),
        ...(runningAs !== undefined ? { runningUser: runningAs || null } : {}),
        ...(deploymentMode && Object.values(DeploymentMode).includes(deploymentMode)
          ? { deploymentMode }
          : {}),
        ...(clearPendingAction ? { pendingAction: Prisma.DbNull } : {}),
        ...(updateError ? { lastUpdateError: updateError } : {}),
        ...(clearPendingAction && !updateError ? { lastUpdateError: null } : {}),
      },
    });

    // Record a status transition event when the node recovers from a non-HEALTHY state
    if (prevNode && prevNode.status !== "HEALTHY") {
      await prisma.nodeStatusEvent.create({
        data: {
          nodeId: agent.nodeId,
          fromStatus: prevNode.status,
          toStatus: "HEALTHY",
          reason: "heartbeat received",
        },
      });

      // Broadcast status change to browser SSE connections
      const statusEvent: StatusChangeEvent = {
        type: "status_change",
        nodeId: agent.nodeId,
        fromStatus: prevNode.status,
        toStatus: "HEALTHY",
        reason: "heartbeat received",
      };
      broadcastSSE(statusEvent, agent.environmentId);
    }

    // Merge agent-reported labels with existing UI-set labels.
    // UI-set labels take precedence over agent-reported labels.
    // Uses a single atomic operation to avoid TOCTOU race with fleet.updateLabels:
    // agent labels are the base, existing DB labels override on top.
    if (parsed.data.labels) {
      await prisma.$executeRaw`
        UPDATE "VectorNode"
        SET labels = ${JSON.stringify(parsed.data.labels)}::jsonb || labels
        WHERE id = ${node.id}
      `;
    }

    // Read previous snapshots BEFORE upserting so we can compute deltas correctly
    const prevSnapshots = new Map<string, {
      eventsIn: bigint;
      eventsOut: bigint;
      errorsTotal: bigint;
      eventsDiscarded: bigint;
      bytesIn: bigint;
      bytesOut: bigint;
      status: string;
    }>();
    const pipelineIds = pipelines.map((p) => p.pipelineId);
    if (pipelineIds.length > 0) {
      const existingStatuses = await prisma.nodePipelineStatus.findMany({
        where: {
          nodeId: agent.nodeId,
          pipelineId: { in: pipelineIds },
        },
        select: {
          pipelineId: true,
          eventsIn: true,
          eventsOut: true,
          errorsTotal: true,
          eventsDiscarded: true,
          bytesIn: true,
          bytesOut: true,
          status: true,
        },
      });
      for (const s of existingStatuses) {
        prevSnapshots.set(`${agent.nodeId}:${s.pipelineId}`, {
          eventsIn: s.eventsIn,
          eventsOut: s.eventsOut,
          errorsTotal: s.errorsTotal,
          eventsDiscarded: s.eventsDiscarded,
          bytesIn: s.bytesIn,
          bytesOut: s.bytesOut,
          status: s.status,
        });
      }
    }

    // Batch upsert pipeline statuses with a single INSERT...ON CONFLICT
    await batchUpsertPipelineStatuses(agent.nodeId, pipelines, now);

    // Emit SSE status_change for any pipeline status transitions
    for (const p of pipelines) {
      const prev = prevSnapshots.get(`${agent.nodeId}:${p.pipelineId}`);
      if (prev && prev.status !== p.status) {
        const pipelineStatusEvent: StatusChangeEvent = {
          type: "status_change",
          nodeId: agent.nodeId,
          fromStatus: prev.status,
          toStatus: p.status,
          reason: "heartbeat status transition",
          pipelineId: p.pipelineId,
          pipelineName: pipelineNameMap.get(p.pipelineId) ?? p.pipelineId,
        };
        broadcastSSE(pipelineStatusEvent, agent.environmentId);
      }
    }

    // Remove statuses for pipelines no longer reported by this node
    const reportedPipelineIds = pipelines.map((p) => p.pipelineId);
    if (reportedPipelineIds.length > 0) {
      await prisma.nodePipelineStatus.deleteMany({
        where: {
          nodeId: agent.nodeId,
          pipelineId: { notIn: reportedPipelineIds },
        },
      });
    } else {
      await prisma.nodePipelineStatus.deleteMany({
        where: { nodeId: agent.nodeId },
      });
    }

    // Broadcast fleet status event for this node (one per heartbeat)
    const fleetEvent: FleetStatusEvent = {
      type: "fleet_status",
      nodeId: agent.nodeId,
      status: "HEALTHY",
      timestamp: now.getTime(),
    };
    broadcastSSE(fleetEvent, agent.environmentId);

    // Store host metrics time-series data
    if (hostMetrics) {
      prisma.nodeMetric
        .create({
          data: {
            nodeId: agent.nodeId,
            timestamp: now,
            memoryTotalBytes: hostMetrics.memoryTotalBytes ?? 0,
            memoryUsedBytes: hostMetrics.memoryUsedBytes ?? 0,
            memoryFreeBytes: hostMetrics.memoryFreeBytes ?? 0,
            cpuSecondsTotal: hostMetrics.cpuSecondsTotal ?? 0,
            cpuSecondsIdle: hostMetrics.cpuSecondsIdle ?? 0,
            loadAvg1: hostMetrics.loadAvg1 ?? 0,
            loadAvg5: hostMetrics.loadAvg5 ?? 0,
            loadAvg15: hostMetrics.loadAvg15 ?? 0,
            fsTotalBytes: hostMetrics.fsTotalBytes ?? 0,
            fsUsedBytes: hostMetrics.fsUsedBytes ?? 0,
            fsFreeBytes: hostMetrics.fsFreeBytes ?? 0,
            diskReadBytes: hostMetrics.diskReadBytes ?? 0,
            diskWrittenBytes: hostMetrics.diskWrittenBytes ?? 0,
            netRxBytes: hostMetrics.netRxBytes ?? 0,
            netTxBytes: hostMetrics.netTxBytes ?? 0,
          },
        })
        .catch((err) => errorLog("agent-heartbeat", "Node metrics insert error", err));
    }

    // Shared minute-truncated timestamp for all metric rows this heartbeat
    const minuteTimestamp = new Date();
    minuteTimestamp.setSeconds(0, 0);

    // Ingest metrics from pipelines that report counter data
    const metricsData = pipelines
      .filter((p) => p.eventsIn !== undefined)
      .map((p) => ({
        nodeId: agent.nodeId,
        pipelineId: p.pipelineId,
        eventsIn: BigInt(p.eventsIn ?? 0),
        eventsOut: BigInt(p.eventsOut ?? 0),
        errorsTotal: BigInt(p.errorsTotal ?? 0),
        eventsDiscarded: BigInt(p.eventsDiscarded ?? 0),
        bytesIn: BigInt(p.bytesIn ?? 0),
        bytesOut: BigInt(p.bytesOut ?? 0),
        utilization: p.utilization ?? 0,
        latencyMeanMs: computeWeightedLatency(p.componentMetrics),
      }));

    if (metricsData.length > 0) {
      ingestMetrics(metricsData, prevSnapshots).catch((err) =>
        errorLog("agent-heartbeat", "Metrics ingestion error", err),
      );
    }

    // Write per-component latency rows (direct create, bypasses delta-tracking)
    const componentLatencyRows: Array<{
      pipelineId: string;
      nodeId: string;
      componentId: string;
      timestamp: Date;
      latencyMeanMs: number;
    }> = [];

    for (const ps of pipelines) {
      if (!Array.isArray(ps.componentMetrics)) continue;
      for (const cm of ps.componentMetrics) {
        if (cm.latencyMeanSeconds != null && cm.latencyMeanSeconds > 0) {
          componentLatencyRows.push({
            pipelineId: ps.pipelineId,
            nodeId: agent.nodeId,
            componentId: cm.componentId,
            timestamp: minuteTimestamp,
            latencyMeanMs: cm.latencyMeanSeconds * 1000,
          });
        }
      }
    }

    if (componentLatencyRows.length > 0) {
      prisma.$transaction([
        prisma.pipelineMetric.deleteMany({
          where: {
            nodeId: agent.nodeId,
            componentId: { not: null },
            timestamp: minuteTimestamp,
          },
        }),
        prisma.pipelineMetric.createMany({ data: componentLatencyRows }),
      ]).catch((err) => errorLog("agent-heartbeat", "Per-component latency upsert error", err));
    }

    // Feed per-component metrics into the in-memory MetricStore for editor overlays
    for (const ps of pipelines) {
      if (Array.isArray(ps.componentMetrics) && ps.componentMetrics.length > 0) {
        for (const cm of ps.componentMetrics) {
          metricStore.recordTotals(agent.nodeId, ps.pipelineId, cm.componentId, {
            receivedEventsTotal: cm.receivedEvents,
            sentEventsTotal: cm.sentEvents,
            receivedBytesTotal: cm.receivedBytes ?? 0,
            sentBytesTotal: cm.sentBytes ?? 0,
            errorsTotal: cm.errorsTotal ?? 0,
            discardedTotal: cm.discardedEvents ?? 0,
            latencyMeanSeconds: cm.latencyMeanSeconds,
          });
        }
        // Flush MetricStore and broadcast metric_update events to browser SSE connections
        const flushEvents = metricStore.flush(agent.nodeId, ps.pipelineId);
        for (const event of flushEvents) {
          broadcastSSE(event, agent.environmentId);
        }
        // Publish the full batch to Redis for cross-instance delivery
        broadcastMetrics(flushEvents, agent.environmentId);
      }
    }

    // Persist pipeline logs and broadcast to browser SSE connections
    for (const ps of pipelines) {
      if (Array.isArray(ps.recentLogs) && ps.recentLogs.length > 0) {
        ingestLogs(agent.nodeId, ps.pipelineId, agent.environmentId, ps.recentLogs).catch((err) =>
          errorLog("agent-heartbeat", "Log ingestion error", err),
        );

        const logEvent: LogEntryEvent = {
          type: "log_entry",
          nodeId: agent.nodeId,
          pipelineId: ps.pipelineId,
          lines: ps.recentLogs,
        };
        broadcastSSE(logEvent, agent.environmentId);
      }
    }

    // Process event sample results from the agent (fire-and-forget)
    const sampleResults = parsed.data.sampleResults;

    if (Array.isArray(sampleResults) && sampleResults.length > 0) {
      processSampleResults(sampleResults, agent.nodeId, agent.environmentId).catch((err) =>
        errorLog("agent-heartbeat", "Sample processing error", err),
      );
    }

    // Check fleet-wide node health
    checkNodeHealth().catch((err) =>
      errorLog("agent-heartbeat", "Node health check error", err),
    );

    // Throttle cleanup to once per hour. Only leader runs cleanup.
    const ONE_HOUR = 60 * 60 * 1000;
    if (isLeader() && Date.now() - lastCleanup > ONE_HOUR) {
      lastCleanup = Date.now();
      cleanupOldMetrics().catch((err) =>
        errorLog("agent-heartbeat", "Metrics cleanup error", err),
      );

      prisma.eventSampleRequest
        .updateMany({
          where: { status: "PENDING", expiresAt: { lt: new Date() } },
          data: { status: "EXPIRED" },
        })
        .catch((err) => errorLog("agent-heartbeat", "Sample request cleanup error", err));

      prisma.eventSampleRequest
        .deleteMany({
          where: {
            status: { in: ["COMPLETED", "ERROR", "EXPIRED"] },
            requestedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        })
        .catch((err) => errorLog("agent-heartbeat", "Old sample cleanup error", err));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    errorLog("agent-heartbeat", "Agent heartbeat error", error);
    return NextResponse.json(
      { error: "Heartbeat processing failed" },
      { status: 500 },
    );
  }
}
