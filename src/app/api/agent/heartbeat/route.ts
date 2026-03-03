import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/server/services/agent-auth";
import { checkNodeHealth } from "@/server/services/fleet-health";
import { ingestMetrics } from "@/server/services/metrics-ingest";
import { ingestLogs } from "@/server/services/log-ingest";
import { cleanupOldMetrics } from "@/server/services/metrics-cleanup";
import { metricStore } from "@/server/services/metric-store";
import { evaluateAlerts } from "@/server/services/alert-evaluator";
import { deliverWebhooks } from "@/server/services/webhook-delivery";
import { DeploymentMode } from "@/generated/prisma";
import { isVersionOlder } from "@/lib/version";

let lastCleanup = 0;

interface PipelineStatus {
  pipelineId: string;
  version: number;
  status: "RUNNING" | "STARTING" | "STOPPED" | "CRASHED" | "PENDING";
  pid?: number;
  uptimeSeconds?: number;
  eventsIn?: number;
  eventsOut?: number;
  errorsTotal?: number;
  bytesIn?: number;
  bytesOut?: number;
  eventsDiscarded?: number;
  componentMetrics?: Array<{
    componentId: string;
    componentKind: string;
    receivedEvents: number;
    sentEvents: number;
    receivedBytes?: number;
    sentBytes?: number;
    errorsTotal?: number;
    discardedEvents?: number;
  }>;
  utilization?: number;
  recentLogs?: string[];
}

interface HostMetrics {
  memoryTotalBytes?: number;
  memoryUsedBytes?: number;
  memoryFreeBytes?: number;
  cpuSecondsTotal?: number;
  loadAvg1?: number;
  loadAvg5?: number;
  loadAvg15?: number;
  fsTotalBytes?: number;
  fsUsedBytes?: number;
  fsFreeBytes?: number;
  diskReadBytes?: number;
  diskWrittenBytes?: number;
  netRxBytes?: number;
  netTxBytes?: number;
}

export async function POST(request: Request) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { pipelines, hostMetrics, agentVersion, vectorVersion, deploymentMode } = body as {
      pipelines: PipelineStatus[];
      hostMetrics?: HostMetrics;
      agentVersion?: string;
      vectorVersion?: string;
      deploymentMode?: DeploymentMode;
    };

    if (!Array.isArray(pipelines)) {
      return NextResponse.json(
        { error: "pipelines array is required" },
        { status: 400 },
      );
    }

    const now = new Date();

    // Check if pendingAction should be cleared (agent has updated to target version)
    let clearPendingAction = false;
    if (agentVersion) {
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

    // Update node heartbeat and metadata
    await prisma.vectorNode.update({
      where: { id: agent.nodeId },
      data: {
        lastHeartbeat: now,
        lastSeen: now,
        status: "HEALTHY",
        ...(agentVersion ? { agentVersion } : {}),
        ...(vectorVersion ? { vectorVersion } : {}),
        ...(deploymentMode && Object.values(DeploymentMode).includes(deploymentMode)
          ? { deploymentMode }
          : {}),
        ...(clearPendingAction ? { pendingAction: Prisma.DbNull } : {}),
      },
    });

    // Read previous snapshots BEFORE upserting so we can compute deltas correctly
    const prevSnapshots = new Map<string, {
      eventsIn: bigint;
      eventsOut: bigint;
      errorsTotal: bigint;
      eventsDiscarded: bigint;
      bytesIn: bigint;
      bytesOut: bigint;
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
        });
      }
    }

    // Upsert pipeline statuses
    for (const ps of pipelines) {
      await prisma.nodePipelineStatus.upsert({
        where: {
          nodeId_pipelineId: {
            nodeId: agent.nodeId,
            pipelineId: ps.pipelineId,
          },
        },
        create: {
          nodeId: agent.nodeId,
          pipelineId: ps.pipelineId,
          version: ps.version,
          status: ps.status,
          pid: ps.pid ?? null,
          uptimeSeconds: ps.uptimeSeconds ?? null,
          eventsIn: ps.eventsIn ?? 0,
          eventsOut: ps.eventsOut ?? 0,
          errorsTotal: ps.errorsTotal ?? 0,
          eventsDiscarded: ps.eventsDiscarded ?? 0,
          bytesIn: ps.bytesIn ?? 0,
          bytesOut: ps.bytesOut ?? 0,
          utilization: ps.utilization ?? 0,
          recentLogs: ps.recentLogs ?? undefined,
          lastUpdated: now,
        },
        update: {
          version: ps.version,
          status: ps.status,
          pid: ps.pid ?? null,
          uptimeSeconds: ps.uptimeSeconds ?? null,
          eventsIn: ps.eventsIn ?? 0,
          eventsOut: ps.eventsOut ?? 0,
          errorsTotal: ps.errorsTotal ?? 0,
          eventsDiscarded: ps.eventsDiscarded ?? 0,
          bytesIn: ps.bytesIn ?? 0,
          bytesOut: ps.bytesOut ?? 0,
          utilization: ps.utilization ?? 0,
          recentLogs: ps.recentLogs ?? undefined,
          lastUpdated: now,
        },
      });
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
        .catch((err) => console.error("Node metrics insert error:", err));
    }

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
      }));

    if (metricsData.length > 0) {
      ingestMetrics(metricsData, prevSnapshots).catch((err) =>
        console.error("Metrics ingestion error:", err),
      );
    }

    // Feed per-component metrics into the in-memory MetricStore for editor overlays
    for (const ps of pipelines) {
      if (Array.isArray(ps.componentMetrics) && ps.componentMetrics.length > 0) {
        for (const cm of ps.componentMetrics) {
          metricStore.recordTotals(agent.nodeId, cm.componentId, {
            receivedEventsTotal: cm.receivedEvents,
            sentEventsTotal: cm.sentEvents,
            receivedBytesTotal: cm.receivedBytes ?? 0,
            sentBytesTotal: cm.sentBytes ?? 0,
          });
        }
      }
    }

    // Persist pipeline logs
    for (const ps of pipelines) {
      if (Array.isArray(ps.recentLogs) && ps.recentLogs.length > 0) {
        ingestLogs(agent.nodeId, ps.pipelineId, ps.recentLogs).catch((err) =>
          console.error("Log ingestion error:", err),
        );
      }
    }

    // Process event sample results from the agent
    const sampleResults = body.sampleResults as Array<{
      requestId: string;
      componentKey: string;
      events?: unknown[];
      schema?: Array<{ path: string; type: string; sample: string }>;
      error?: string;
    }> | undefined;

    if (Array.isArray(sampleResults) && sampleResults.length > 0) {
      for (const result of sampleResults) {
        if (!result.requestId) continue;
        const request = await prisma.eventSampleRequest.findUnique({
          where: { id: result.requestId },
          select: { pipelineId: true, status: true },
        });
        if (!request || request.status !== "PENDING") continue;

        await prisma.eventSample.create({
          data: {
            requestId: result.requestId,
            pipelineId: request.pipelineId,
            componentKey: result.componentKey ?? "",
            events: (result.events ?? []) as any,
            schema: (result.schema ?? []) as any,
            error: result.error ?? null,
          },
        });

        await prisma.eventSampleRequest.update({
          where: { id: result.requestId },
          data: {
            status: result.error ? "ERROR" : "COMPLETED",
            completedAt: new Date(),
            nodeId: agent.nodeId,
          },
        });
      }
    }

    // Check fleet-wide node health
    checkNodeHealth().catch((err) =>
      console.error("Node health check error:", err),
    );

    // Evaluate alert rules and deliver webhooks for any fired/resolved alerts
    try {
      const firedAlerts = await evaluateAlerts(agent.nodeId, agent.environmentId);

      if (firedAlerts.length > 0) {
        // Fetch context once for all alerts in this batch
        const [nodeInfo, envInfo] = await Promise.all([
          prisma.vectorNode.findUnique({
            where: { id: agent.nodeId },
            select: { host: true },
          }),
          prisma.environment.findUnique({
            where: { id: agent.environmentId },
            select: { name: true, team: { select: { name: true } } },
          }),
        ]);

        for (const alert of firedAlerts) {
          const pipeline = alert.rule.pipelineId
            ? await prisma.pipeline.findUnique({
                where: { id: alert.rule.pipelineId },
                select: { name: true },
              })
            : null;

          await deliverWebhooks(alert.rule.environmentId, {
            alertId: alert.event.id,
            status: alert.event.status as "firing" | "resolved",
            ruleName: alert.rule.name,
            severity: "warning",
            environment: envInfo?.name ?? "Unknown",
            team: envInfo?.team?.name,
            node: nodeInfo?.host ?? agent.nodeId,
            pipeline: pipeline?.name,
            metric: alert.rule.metric,
            value: alert.event.value,
            threshold: alert.rule.threshold,
            message: alert.event.message ?? "",
            timestamp: alert.event.firedAt.toISOString(),
            dashboardUrl: `${process.env.NEXTAUTH_URL ?? ""}/alerts`,
          });
        }
      }
    } catch (err) {
      console.error("Alert evaluation failed:", err);
    }

    // Throttle cleanup to once per hour
    const ONE_HOUR = 60 * 60 * 1000;
    if (Date.now() - lastCleanup > ONE_HOUR) {
      lastCleanup = Date.now();
      cleanupOldMetrics().catch((err) =>
        console.error("Metrics cleanup error:", err),
      );

      prisma.eventSampleRequest
        .updateMany({
          where: { status: "PENDING", expiresAt: { lt: new Date() } },
          data: { status: "EXPIRED" },
        })
        .catch((err) => console.error("Sample request cleanup error:", err));

      prisma.eventSampleRequest
        .deleteMany({
          where: {
            status: { in: ["COMPLETED", "ERROR", "EXPIRED"] },
            requestedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        })
        .catch((err) => console.error("Old sample cleanup error:", err));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Agent heartbeat error:", error);
    return NextResponse.json(
      { error: "Heartbeat processing failed" },
      { status: 500 },
    );
  }
}
