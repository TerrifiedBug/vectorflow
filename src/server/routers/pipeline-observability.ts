import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { LogLevel } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { evaluatePipelineHealth } from "@/server/services/sli-evaluator";
import { batchEvaluatePipelineHealth } from "@/server/services/batch-health";
import {
  getPipelineCostSnapshot,
  computeCostCents,
} from "@/server/services/cost-attribution";

const ANOMALY_SEVERITY_RANK = ["critical", "warning", "info"] as const;
type AnomalySeverity = (typeof ANOMALY_SEVERITY_RANK)[number];

function pickMaxSeverity(
  severities: ReadonlyArray<{ severity: string }>,
): AnomalySeverity | null {
  for (const rank of ANOMALY_SEVERITY_RANK) {
    if (severities.some((s) => s.severity === rank)) return rank;
  }
  return null;
}

interface ScorecardRecommendedAction {
  kind:
    | "investigate_sli"
    | "review_anomaly"
    | "ack_alerts"
    | "review_error_spike"
    | "apply_cost_recommendation";
  message: string;
}

function deriveRecommendedAction(input: {
  health: { status: string; slis: Array<{ metric: string; status: string }> };
  anomalies: { openCount: number; maxSeverity: AnomalySeverity | null };
  alerts: { firingCount: number };
  errorRateRatio: number | null;
  recommendations: Array<{ title: string }>;
}): ScorecardRecommendedAction | null {
  if (input.health.status === "degraded") {
    const breached = input.health.slis.find((s) => s.status === "breached");
    return {
      kind: "investigate_sli",
      message: breached
        ? `Investigate breached SLI: ${breached.metric}`
        : "Investigate breached SLI",
    };
  }
  if (input.anomalies.openCount > 0) {
    const sev = input.anomalies.maxSeverity ?? "open";
    return {
      kind: "review_anomaly",
      message: `Review ${input.anomalies.openCount} ${sev} anomaly event${input.anomalies.openCount === 1 ? "" : "s"}`,
    };
  }
  if (input.alerts.firingCount > 0) {
    return {
      kind: "ack_alerts",
      message: `Acknowledge ${input.alerts.firingCount} firing alert${input.alerts.firingCount === 1 ? "" : "s"}`,
    };
  }
  if (input.errorRateRatio !== null && input.errorRateRatio >= 2) {
    return {
      kind: "review_error_spike",
      message: `Error rate is ${input.errorRateRatio.toFixed(1)}× the 7-day baseline`,
    };
  }
  if (input.recommendations.length > 0) {
    return {
      kind: "apply_cost_recommendation",
      message: `Apply cost recommendation: ${input.recommendations[0].title}`,
    };
  }
  return null;
}
import { tryLocalPush, relayPush } from "@/server/services/push-broadcast";
import { pushRegistry } from "@/server/services/push-registry";
import {
  setActiveTap,
  deleteActiveTap,
  expireStaleTaps,
  TAP_TTL_MS,
} from "@/server/services/active-taps";

export async function startTapHandler(
  nodeId: string,
  pipelineId: string,
  componentId: string,
): Promise<string> {
  const requestId = nanoid();
  await setActiveTap(requestId, { nodeId, pipelineId, componentId });
  relayPush(nodeId, {
    type: "tap_start" as const,
    requestId,
    pipelineId,
    componentId,
  });
  return requestId;
}

export async function stopTapHandler(requestId: string): Promise<void> {
  const tap = await deleteActiveTap(requestId);
  if (!tap) return;
  relayPush(tap.nodeId, {
    type: "tap_stop" as const,
    requestId,
  });
}

export async function cleanupStaleTaps(): Promise<void> {
  const stale = await expireStaleTaps();
  for (const { requestId, nodeId } of stale) {
    relayPush(nodeId, {
      type: "tap_stop" as const,
      requestId,
    });
  }
}

const sweepTimer = setInterval(() => {
  // Catch DB errors so a transient failure during the sweep doesn't surface
  // as an unhandled rejection (which can terminate the process).
  cleanupStaleTaps().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("cleanupStaleTaps failed", err);
  });
}, TAP_TTL_MS);
if (typeof sweepTimer === "object" && "unref" in sweepTimer) {
  sweepTimer.unref();
}

// ── Router ─────────────────────────────────────────────────────────────────

export const pipelineObservabilityRouter = router({
  metrics: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        hours: z.number().min(1).max(168).default(24),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);

      return prisma.pipelineMetric.findMany({
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
          eventsDiscarded: true,
          errorsTotal: true,
          bytesIn: true,
          bytesOut: true,
          utilization: true,
          latencyMeanMs: true,
        },
      });
    }),

  logs: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(500).default(200),
        levels: z.array(z.nativeEnum(LogLevel)).optional(),
        nodeId: z.string().optional(),
        since: z.date().optional(),
        search: z.string().max(200).optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { pipelineId, cursor, limit, levels, nodeId, since, search } = input;
      const take = limit;

      const where: Record<string, unknown> = { pipelineId };
      if (levels && levels.length > 0) {
        where.level = { in: levels };
      }
      if (nodeId) {
        where.nodeId = nodeId;
      }
      if (since) {
        where.timestamp = { gte: since };
      }
      if (search) {
        where.message = { contains: search, mode: "insensitive" };
      }

      const items = await prisma.pipelineLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          node: { select: { name: true } },
          pipeline: { select: { name: true } },
        },
      });

      let nextCursor: string | undefined;
      if (items.length > take) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id;
      }

      return { items, nextCursor };
    }),

  requestSamples: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        componentKeys: z.array(z.string()),
        limit: z.number().min(1).max(50).default(5),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: { id: true, isDraft: true, deployedAt: true },
      });
      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }
      if (pipeline.isDraft || !pipeline.deployedAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Pipeline must be deployed to sample events",
        });
      }

      const statuses = await prisma.nodePipelineStatus.findMany({
        where: { pipelineId: input.pipelineId, status: "RUNNING" },
        select: { nodeId: true },
      });
      if (statuses.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No running nodes found for this pipeline",
        });
      }

      const request = await prisma.eventSampleRequest.create({
        data: {
          pipelineId: input.pipelineId,
          componentKeys: input.componentKeys,
          limit: input.limit,
          // Bound below (or left null for fan-out claim — see below).
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        },
      });

      const message = {
        type: "sample_request" as const,
        requestId: request.id,
        pipelineId: input.pipelineId,
        componentKeys: input.componentKeys,
        limit: input.limit,
      };

      // Strategy:
      // 1. For each running node connected via local SSE: atomically bind the
      //    request BEFORE pushing. The conditional update (nodeId: null)
      //    guarantees that an agent racing through the /api/agent/config poll
      //    cannot claim this request between probe and bind — once the
      //    binding is set, the heartbeat-claim path's
      //    `OR: [{ nodeId: null }, { nodeId: agent }]` predicate rejects any
      //    other node's claim attempt.
      // 2. If no local node was reachable (or all SSE writes raced and
      //    failed), fan out via Redis to every running node and leave nodeId
      //    NULL so whichever agent picks it up first atomically claims it.
      let localBinding: string | null = null;
      for (const { nodeId } of statuses) {
        if (!pushRegistry.isConnected(nodeId)) continue;

        const claim = await prisma.eventSampleRequest.updateMany({
          where: { id: request.id, status: "PENDING", nodeId: null },
          data: { nodeId },
        });
        if (claim.count === 0) {
          // An agent that polled /api/agent/config in the gap between create
          // and bind has already claimed this request via heartbeat. Leave
          // their binding intact and surface the request as PENDING.
          return { requestId: request.id, status: "PENDING" };
        }

        if (tryLocalPush(nodeId, message)) {
          localBinding = nodeId;
          break;
        }

        // SSE connection dropped between isConnected() and send(). Release
        // the binding so the next loop iteration (or fan-out below) can claim.
        await prisma.eventSampleRequest.updateMany({
          where: { id: request.id, status: "PENDING", nodeId },
          data: { nodeId: null },
        });
      }

      if (localBinding) {
        return { requestId: request.id, status: "PENDING" };
      }

      // No local delivery — fan out via Redis to every running node. Any of
      // them on another instance can claim the request via atomic update.
      let anyReachable = false;
      for (const { nodeId } of statuses) {
        if (relayPush(nodeId, message)) {
          anyReachable = true;
        }
      }

      if (!anyReachable) {
        await prisma.eventSampleRequest.delete({ where: { id: request.id } });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No reachable nodes for this pipeline",
        });
      }

      return { requestId: request.id, status: "PENDING" };
    }),

  sampleResult: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const request = await prisma.eventSampleRequest.findUnique({
        where: { id: input.requestId },
        include: {
          samples: {
            select: {
              id: true,
              componentKey: true,
              events: true,
              schema: true,
              error: true,
              sampledAt: true,
            },
          },
        },
      });
      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sample request not found",
        });
      }

      return {
        requestId: request.id,
        status: request.status,
        samples: request.samples,
      };
    }),

  eventSchemas: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const samples = await prisma.eventSample.findMany({
        where: {
          pipelineId: input.pipelineId,
          error: null,
        },
        orderBy: { sampledAt: "desc" },
        select: {
          componentKey: true,
          schema: true,
          events: true,
          sampledAt: true,
        },
      });

      // Deduplicate: keep only the most recent sample per componentKey
      const seen = new Set<string>();
      const deduplicated = [];
      for (const sample of samples) {
        if (!seen.has(sample.componentKey)) {
          seen.add(sample.componentKey);
          deduplicated.push(sample);
        }
      }

      return deduplicated;
    }),

  listSlis: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.pipelineSli.findMany({
        where: { pipelineId: input.pipelineId },
        orderBy: { createdAt: "asc" },
      });
    }),

  upsertSli: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        metric: z.enum(["error_rate", "throughput_floor", "discard_rate"]),
        condition: z.enum(["lt", "gt"]),
        threshold: z.number().min(0),
        windowMinutes: z.number().int().min(1).max(1440).default(5),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.sli_upserted", "Pipeline"))
    .mutation(async ({ input }) => {
      return prisma.pipelineSli.upsert({
        where: {
          pipelineId_metric: {
            pipelineId: input.pipelineId,
            metric: input.metric,
          },
        },
        update: {
          condition: input.condition,
          threshold: input.threshold,
          windowMinutes: input.windowMinutes,
        },
        create: {
          pipelineId: input.pipelineId,
          metric: input.metric,
          condition: input.condition,
          threshold: input.threshold,
          windowMinutes: input.windowMinutes,
        },
      });
    }),

  deleteSli: protectedProcedure
    .input(z.object({ id: z.string(), pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.sli_deleted", "Pipeline"))
    .mutation(async ({ input }) => {
      const sli = await prisma.pipelineSli.findUnique({
        where: { id: input.id },
      });
      if (!sli || sli.pipelineId !== input.pipelineId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SLI not found",
        });
      }
      return prisma.pipelineSli.delete({
        where: { id: input.id },
      });
    }),

  health: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return evaluatePipelineHealth(input.pipelineId);
    }),

  batchHealth: protectedProcedure
    .input(z.object({ pipelineIds: z.array(z.string()).max(200) }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return batchEvaluatePipelineHealth(input.pipelineIds);
    }),

  scorecard: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: {
          id: true,
          name: true,
          isDraft: true,
          deployedAt: true,
          environmentId: true,
          environment: { select: { costPerGbCents: true } },
        },
      });
      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      const now = Date.now();
      const since24h = new Date(now - 24 * 60 * 60 * 1000);
      const since48h = new Date(now - 48 * 60 * 60 * 1000);
      const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const costPerGbCents = pipeline.environment.costPerGbCents;

      const [
        health,
        firingAlerts,
        openAnomalyCount,
        anomalySeverities,
        last24h,
        prior24hAgg,
        current24hAgg,
        sevenDayAgg,
        recommendations,
      ] = await Promise.all([
        evaluatePipelineHealth(input.pipelineId),
        prisma.alertEvent.count({
          where: {
            alertRule: { pipelineId: input.pipelineId },
            status: "firing",
          },
        }),
        prisma.anomalyEvent.count({
          where: { pipelineId: input.pipelineId, status: "open" },
        }),
        prisma.anomalyEvent.findMany({
          where: { pipelineId: input.pipelineId, status: "open" },
          select: { severity: true },
          distinct: ["severity"],
        }),
        getPipelineCostSnapshot(input.pipelineId, costPerGbCents, "1d"),
        prisma.pipelineMetric.aggregate({
          where: {
            pipelineId: input.pipelineId,
            nodeId: null,
            componentId: null,
            timestamp: { gte: since48h, lt: since24h },
          },
          _sum: { bytesIn: true, bytesOut: true },
        }),
        prisma.pipelineMetric.aggregate({
          where: {
            pipelineId: input.pipelineId,
            nodeId: null,
            componentId: null,
            timestamp: { gte: since24h },
          },
          _sum: { eventsIn: true, errorsTotal: true },
        }),
        prisma.pipelineMetric.aggregate({
          where: {
            pipelineId: input.pipelineId,
            nodeId: null,
            componentId: null,
            timestamp: { gte: since7d },
          },
          _sum: { eventsIn: true, errorsTotal: true },
        }),
        prisma.costRecommendation.findMany({
          where: { pipelineId: input.pipelineId, status: "PENDING" },
          orderBy: { estimatedSavingsBytes: "desc" },
          take: 5,
          select: {
            id: true,
            title: true,
            type: true,
            estimatedSavingsBytes: true,
          },
        }),
      ]);

      const priorBytesIn = Number(prior24hAgg._sum.bytesIn ?? 0);
      const priorBytesOut = Number(prior24hAgg._sum.bytesOut ?? 0);
      const prior24h = {
        bytesIn: priorBytesIn,
        bytesOut: priorBytesOut,
        costCents: computeCostCents(priorBytesIn, costPerGbCents),
      };

      const deltaPercent =
        priorBytesIn === 0
          ? null
          : ((last24h.bytesIn - priorBytesIn) / priorBytesIn) * 100;

      const currentEventsIn = Number(current24hAgg._sum.eventsIn ?? 0);
      const currentErrors = Number(current24hAgg._sum.errorsTotal ?? 0);
      const sevenDayEventsIn = Number(sevenDayAgg._sum.eventsIn ?? 0);
      const sevenDayErrors = Number(sevenDayAgg._sum.errorsTotal ?? 0);

      const currentErrorRate =
        currentEventsIn === 0 ? null : currentErrors / currentEventsIn;
      const baselineErrorRate =
        sevenDayEventsIn === 0 ? null : sevenDayErrors / sevenDayEventsIn;
      const errorRateRatio =
        currentErrorRate === null ||
        baselineErrorRate === null ||
        baselineErrorRate === 0
          ? null
          : currentErrorRate / baselineErrorRate;

      const currentThroughput = currentEventsIn / (24 * 60 * 60);
      const baselineThroughput = sevenDayEventsIn / (7 * 24 * 60 * 60);
      const throughputRatio =
        baselineThroughput === 0 ? null : currentThroughput / baselineThroughput;

      const maxSeverity = pickMaxSeverity(anomalySeverities);

      const recommendedAction = deriveRecommendedAction({
        health,
        anomalies: { openCount: openAnomalyCount, maxSeverity },
        alerts: { firingCount: firingAlerts },
        errorRateRatio,
        recommendations,
      });

      return {
        pipeline: {
          id: pipeline.id,
          name: pipeline.name,
          isDraft: pipeline.isDraft,
          deployedAt: pipeline.deployedAt,
          environmentId: pipeline.environmentId,
        },
        health,
        alerts: { firingCount: firingAlerts },
        anomalies: { openCount: openAnomalyCount, maxSeverity },
        cost: {
          last24h,
          prior24h,
          deltaPercent,
          costPerGbCents,
        },
        trend: {
          errorRate:
            currentErrorRate === null && baselineErrorRate === null
              ? null
              : {
                  current: currentErrorRate,
                  baseline7d: baselineErrorRate,
                  deltaRatio: errorRateRatio,
                },
          throughput: {
            currentEventsPerSec: currentThroughput,
            baseline7dEventsPerSec: baselineThroughput,
            deltaRatio: throughputRatio,
          },
        },
        recommendations: recommendations.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          estimatedSavingsBytes:
            r.estimatedSavingsBytes === null
              ? null
              : Number(r.estimatedSavingsBytes),
        })),
        recommendedAction,
      };
    }),

  startTap: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        componentId: z.string(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.tap_started", "Pipeline"))
    .mutation(async ({ input }) => {
      const statuses = await prisma.nodePipelineStatus.findMany({
        where: { pipelineId: input.pipelineId, status: "RUNNING" },
        select: { nodeId: true },
      });
      if (statuses.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No running nodes found for this pipeline",
        });
      }
      const requestId = await startTapHandler(
        statuses[0].nodeId,
        input.pipelineId,
        input.componentId,
      );
      return { requestId };
    }),

  stopTap: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withAudit("pipeline.tap_stopped", "Pipeline"))
    .mutation(async ({ input }) => {
      await stopTapHandler(input.requestId);
      return { ok: true };
    }),
});
