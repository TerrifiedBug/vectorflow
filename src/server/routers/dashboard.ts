import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { prisma } from "@/lib/prisma";
import { metricStore } from "@/server/services/metric-store";
import type { AlertMetric } from "@/generated/prisma";
import {
  computeChartMetrics,
  assembleNodeCards,
  assemblePipelineCards,
} from "@/server/services/dashboard-data";
import {
  queryVolumeTimeSeries,
  queryNodeMetricsAggregated,
  resolveMetricsSource,
} from "@/server/services/metrics-query";

export const dashboardRouter = router({
  stats: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const envFilter = { environment: { id: input.environmentId } };
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [pipelineCount, nodeCount, healthyCounts, reductionMetrics, firingAlertCount, openAnomalyCount] = await Promise.all([
        prisma.pipeline.count({
          where: { environmentId: input.environmentId, isDraft: false, deployedAt: { not: null } },
        }),
        prisma.vectorNode.count({ where: envFilter }),
        prisma.vectorNode.groupBy({
          by: ["status"],
          where: envFilter,
          _count: { status: true },
        }),
        prisma.pipelineMetric.aggregate({
          where: {
            nodeId: null, // aggregate rows only
            componentId: null,
            timestamp: { gte: oneHourAgo },
            pipeline: { environmentId: input.environmentId },
          },
          _sum: {
            eventsIn: true,
            eventsOut: true,
          },
        }),
        prisma.alertEvent.count({
          where: {
            status: "firing",
            alertRule: {
              environmentId: input.environmentId,
              metric: {
                notIn: [
                  "deploy_requested",
                  "deploy_completed",
                  "deploy_rejected",
                  "deploy_cancelled",
                  "new_version_available",
                ] as AlertMetric[],
              },
            },
          },
        }),
        prisma.anomalyEvent.count({
          where: {
            environmentId: input.environmentId,
            status: "open",
          },
        }),
      ]);

      const healthy = healthyCounts.find((h) => h.status === "HEALTHY")?._count.status ?? 0;
      const degraded = healthyCounts.find((h) => h.status === "DEGRADED")?._count.status ?? 0;
      const unreachable = healthyCounts.find((h) => h.status === "UNREACHABLE")?._count.status ?? 0;

      const totalEventsIn = Number(reductionMetrics._sum.eventsIn ?? 0);
      const totalEventsOut = Number(reductionMetrics._sum.eventsOut ?? 0);
      const reductionPercent = totalEventsIn > 0
        ? Math.max(0, (1 - totalEventsOut / totalEventsIn) * 100)
        : null;

      return {
        pipelines: pipelineCount,
        nodes: nodeCount,
        fleet: { healthy, degraded, unreachable },
        reduction: {
          percent: reductionPercent,
          eventsIn: totalEventsIn,
          eventsOut: totalEventsOut,
        },
        alerts: firingAlertCount + openAnomalyCount,
      };
    }),

  recentPipelines: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session!.user!.id!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });

    const teamFilter = user?.isSuperAdmin
      ? {}
      : { environment: { team: { members: { some: { userId } } } } };

    return prisma.pipeline.findMany({
      where: teamFilter,
      take: 5,
      orderBy: { updatedAt: "desc" },
      include: { environment: { select: { name: true } } },
    });
  }),

  recentAudit: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session!.user!.id!;

    const [user, memberships] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      }),
      prisma.teamMember.findMany({
        where: { userId },
        select: { teamId: true },
      }),
    ]);

    const teamIdFilter: { teamId?: { in: string[] } } = user?.isSuperAdmin
      ? {}
      : { teamId: { in: memberships.map((m) => m.teamId) } };

    return prisma.auditLog.findMany({
      where: teamIdFilter,
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true } } },
    });
  }),

  nodeCards: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session!.user!.id!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });

    const teamFilter = user?.isSuperAdmin
      ? {}
      : { environment: { team: { members: { some: { userId } } } } };

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const nodes = await prisma.vectorNode.findMany({
      where: teamFilter,
      include: {
        environment: { select: { id: true, name: true } },
        pipelineStatuses: {
          select: {
            status: true,
            eventsIn: true,
            eventsOut: true,
            bytesIn: true,
            bytesOut: true,
            errorsTotal: true,
            pipeline: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: "asc" },
      take: 100,
    });

    // Fetch sparkline data: metrics for last hour per node
    const nodeIds = nodes.map((n) => n.id);
    const metricsRows = nodeIds.length > 0
      ? await prisma.nodeMetric.findMany({
          where: {
            nodeId: { in: nodeIds },
            timestamp: { gte: oneHourAgo },
          },
          orderBy: { timestamp: "asc" },
          select: {
            nodeId: true,
            timestamp: true,
            memoryUsedBytes: true,
            memoryTotalBytes: true,
            cpuSecondsTotal: true,
            cpuSecondsIdle: true,
          },
        })
      : [];

    const latestSamples = metricStore.getLatestAll();

    // Look up component kinds so we only count source for "in" and sink for "out"
    // Scoped to user's pipelines to avoid full-table scan on PipelineNode.
    const pipelineIds = [...new Set(
      nodes.flatMap((n) => n.pipelineStatuses.map((ps) => ps.pipeline.id))
    )];
    const allComponentNodes = pipelineIds.length > 0
      ? await prisma.pipelineNode.findMany({
          where: { pipelineId: { in: pipelineIds } },
          select: { componentKey: true, kind: true },
        })
      : [];
    const componentKindMap = new Map<string, string>();
    for (const cn of allComponentNodes) {
      componentKindMap.set(cn.componentKey, cn.kind);
    }

    return assembleNodeCards(nodes, metricsRows, latestSamples, componentKindMap);
  }),

  pipelineCards: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const pipelines = await prisma.pipeline.findMany({
      where: { environmentId: input.environmentId, isDraft: false, deployedAt: { not: null } },
      include: {
        environment: { select: { id: true, name: true } },
        nodes: true,
        edges: true,
        nodeStatuses: {
          include: {
            node: { select: { id: true, name: true, status: true } },
          },
        },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, configYaml: true, logLevel: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const pipelineIds = pipelines.map((p) => p.id);
    const metricsRows = pipelineIds.length > 0
      ? await prisma.pipelineMetric.findMany({
          where: {
            pipelineId: { in: pipelineIds },
            nodeId: null,
            componentId: null,
            timestamp: { gte: oneHourAgo },
          },
          orderBy: { timestamp: "asc" },
          select: {
            pipelineId: true,
            timestamp: true,
            eventsIn: true,
            eventsOut: true,
            bytesIn: true,
            bytesOut: true,
          },
        })
      : [];

    const latestSamples = metricStore.getLatestAll();

    const pipelineComponentNodes = await prisma.pipelineNode.findMany({
      where: { pipelineId: { in: pipelineIds } },
      select: { pipelineId: true, componentKey: true, kind: true },
      take: 1000,
    });

    return assemblePipelineCards(pipelines, metricsRows, latestSamples, pipelineComponentNodes);
  }),

  operationalOverview: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session!.user!.id!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });

    const teamFilter = user?.isSuperAdmin
      ? {}
      : { environment: { team: { members: { some: { userId } } } } };

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    const [unhealthyNodes, deployedPipelines, recentMetrics] = await Promise.all([
      prisma.vectorNode.findMany({
        where: { status: { not: "HEALTHY" }, ...teamFilter },
        select: {
          id: true,
          name: true,
          host: true,
          status: true,
          lastSeen: true,
          environment: { select: { name: true } },
        },
        orderBy: { lastSeen: "desc" },
        take: 10,
      }),

      prisma.pipeline.findMany({
        where: { isDraft: false, deployedAt: { not: null }, ...teamFilter },
        select: {
          id: true,
          name: true,
          deployedAt: true,
          environment: { select: { name: true } },
          nodeStatuses: {
            select: {
              status: true,
              node: { select: { name: true } },
              eventsIn: true,
              eventsOut: true,
              errorsTotal: true,
            },
          },
        },
        orderBy: { deployedAt: "desc" },
        take: 10,
      }),

      prisma.pipelineMetric.aggregate({
        where: {
          nodeId: null,
          componentId: null,
          timestamp: { gte: fiveMinAgo },
          ...(user?.isSuperAdmin ? {} : { pipeline: teamFilter }),
        },
        _sum: {
          eventsIn: true,
          eventsOut: true,
          errorsTotal: true,
          bytesIn: true,
          bytesOut: true,
        },
      }),
    ]);

    return { unhealthyNodes, deployedPipelines, recentMetrics: recentMetrics._sum };
  }),

  volumeAnalytics: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        range: z.enum(["1h", "6h", "1d", "7d", "30d"]),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const hours = { "1h": 1, "6h": 6, "1d": 24, "7d": 168, "30d": 720 }[input.range];
      const since = new Date(Date.now() - hours * 3600000);
      const prevSince = new Date(since.getTime() - hours * 3600000);

      // Current period aggregates
      const current = await prisma.pipelineMetric.aggregate({
        where: {
          pipeline: { environmentId: input.environmentId },
          componentId: null,
          timestamp: { gte: since },
        },
        _sum: { eventsIn: true, eventsOut: true, bytesIn: true, bytesOut: true },
      });

      // Previous period for trend comparison
      const previous = await prisma.pipelineMetric.aggregate({
        where: {
          pipeline: { environmentId: input.environmentId },
          componentId: null,
          timestamp: { gte: prevSince, lt: since },
        },
        _sum: { eventsIn: true, eventsOut: true, bytesIn: true, bytesOut: true },
      });

      // Per-pipeline breakdown
      const byPipeline = await prisma.pipelineMetric.groupBy({
        by: ["pipelineId"],
        where: {
          pipeline: { environmentId: input.environmentId },
          componentId: null,
          timestamp: { gte: since },
        },
        _sum: { eventsIn: true, eventsOut: true, bytesIn: true, bytesOut: true },
      });

      // Fetch pipeline names
      const pipelineIds = byPipeline.map((p) => p.pipelineId);
      const pipelines = await prisma.pipeline.findMany({
        where: { id: { in: pipelineIds } },
        select: { id: true, name: true },
      });
      const nameMap = Object.fromEntries(pipelines.map((p) => [p.id, p.name]));

      const perPipeline = byPipeline.map((p) => ({
        pipelineId: p.pipelineId,
        pipelineName: nameMap[p.pipelineId] ?? "Unknown",
        bytesIn: Number(p._sum.bytesIn ?? 0),
        bytesOut: Number(p._sum.bytesOut ?? 0),
        eventsIn: Number(p._sum.eventsIn ?? 0),
        eventsOut: Number(p._sum.eventsOut ?? 0),
      }));

      // Time series for volume chart — use continuous aggregates for longer ranges
      const rangeMinutes = hours * 60;
      const source = resolveMetricsSource(rangeMinutes);

      let timeSeries: Array<{
        bucket: string;
        bytesIn: number;
        bytesOut: number;
        eventsIn: number;
        eventsOut: number;
      }>;

      if (source !== "raw") {
        // Use pre-computed continuous aggregate
        const pipelineIds = await prisma.pipeline.findMany({
          where: { environmentId: input.environmentId },
          select: { id: true },
        });
        const envPipelineIds = pipelineIds.map((p) => p.id);

        const aggRows = await queryVolumeTimeSeries({
          environmentPipelineIds: envPipelineIds,
          minutes: rangeMinutes,
          since,
        });

        // Aggregate across pipelines per bucket
        const buckets = new Map<
          number,
          { bytesIn: number; bytesOut: number; eventsIn: number; eventsOut: number }
        >();
        for (const row of aggRows) {
          const t = new Date(row.bucket).getTime();
          const b = buckets.get(t) ?? { bytesIn: 0, bytesOut: 0, eventsIn: 0, eventsOut: 0 };
          b.bytesIn += Number(row.bytesIn ?? 0);
          b.bytesOut += Number(row.bytesOut ?? 0);
          b.eventsIn += Number(row.eventsIn ?? 0);
          b.eventsOut += Number(row.eventsOut ?? 0);
          buckets.set(t, b);
        }

        timeSeries = Array.from(buckets.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([t, b]) => ({
            bucket: new Date(t).toISOString(),
            bytesIn: b.bytesIn,
            bytesOut: b.bytesOut,
            eventsIn: b.eventsIn,
            eventsOut: b.eventsOut,
          }));
      } else {
        // Fallback: bucket raw metrics in JS (existing logic)
        const bucketMs =
          hours <= 1 ? 60000 : hours <= 6 ? 300000 : hours <= 24 ? 900000 : hours <= 168 ? 3600000 : 14400000;

        const rawMetrics = await prisma.pipelineMetric.findMany({
          where: {
            pipeline: { environmentId: input.environmentId },
            componentId: null,
            timestamp: { gte: since },
          },
          select: {
            timestamp: true,
            bytesIn: true,
            bytesOut: true,
            eventsIn: true,
            eventsOut: true,
          },
          orderBy: { timestamp: "desc" },
          take: 50_000,
        });

        const buckets = new Map<
          number,
          { bytesIn: number; bytesOut: number; eventsIn: number; eventsOut: number }
        >();
        for (const m of rawMetrics) {
          const t = Math.floor(new Date(m.timestamp).getTime() / bucketMs) * bucketMs;
          const b = buckets.get(t) ?? { bytesIn: 0, bytesOut: 0, eventsIn: 0, eventsOut: 0 };
          b.bytesIn += Number(m.bytesIn ?? 0);
          b.bytesOut += Number(m.bytesOut ?? 0);
          b.eventsIn += Number(m.eventsIn ?? 0);
          b.eventsOut += Number(m.eventsOut ?? 0);
          buckets.set(t, b);
        }

        timeSeries = Array.from(buckets.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([t, b]) => ({
            bucket: new Date(t).toISOString(),
            bytesIn: b.bytesIn,
            bytesOut: b.bytesOut,
            eventsIn: b.eventsIn,
            eventsOut: b.eventsOut,
          }));
      }

      return { current, previous, perPipeline, timeSeries };
    }),

  chartMetrics: protectedProcedure
    .use(withTeamAccess("VIEWER"))
    .input(
      z.object({
        environmentId: z.string(),
        nodeIds: z.array(z.string()).default([]),
        pipelineIds: z.array(z.string()).default([]),
        range: z.enum(["1h", "6h", "1d", "7d"]).default("1h"),
        groupBy: z.enum(["pipeline", "node", "aggregate"]).default("pipeline"),
      })
    )
    .query(async ({ input }) => {
      const rangeMs: Record<string, number> = {
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "1d": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
      };
      const since = new Date(Date.now() - rangeMs[input.range]);

      const envFilter = { environment: { id: input.environmentId } };

      const [allNodes, allPipelines] = await Promise.all([
        prisma.vectorNode.findMany({
          where: envFilter,
          select: { id: true, name: true },
        }),
        prisma.pipeline.findMany({
          where: { environmentId: input.environmentId, isDraft: false, deployedAt: { not: null } },
          select: { id: true, name: true },
        }),
      ]);

      const nodeIds = input.nodeIds.length > 0
        ? input.nodeIds
        : allNodes.map((n: { id: string; name: string }) => n.id);
      const pipelineIds = input.pipelineIds.length > 0
        ? input.pipelineIds
        : allPipelines.map((p: { id: string; name: string }) => p.id);

      const nodeNameMap = new Map<string, string>(allNodes.map((n: { id: string; name: string }) => [n.id, n.name]));
      const pipelineNameMap = new Map<string, string>(allPipelines.map((p: { id: string; name: string }) => [p.id, p.name]));

      // Resolve effective filters — nodes ↔ pipelines cross-lookup
      let effectivePipelineIds = pipelineIds;
      let effectiveNodeIds = nodeIds;

      // If nodes are filtered, restrict pipelines to those running on selected nodes
      if (input.nodeIds.length > 0) {
        const nodeStatuses = await prisma.nodePipelineStatus.findMany({
          where: { nodeId: { in: input.nodeIds } },
          select: { pipelineId: true },
          distinct: ["pipelineId"],
        });
        const pipelinesOnNodes = new Set(nodeStatuses.map((ns: { pipelineId: string }) => ns.pipelineId));
        effectivePipelineIds = effectivePipelineIds.filter((id: string) => pipelinesOnNodes.has(id));
      }

      // If pipelines are filtered but nodes aren't, restrict nodes to those running selected pipelines
      if (input.pipelineIds.length > 0 && input.nodeIds.length === 0) {
        const nodeStatuses = await prisma.nodePipelineStatus.findMany({
          where: { pipelineId: { in: effectivePipelineIds } },
          select: { nodeId: true },
          distinct: ["nodeId"],
        });
        effectiveNodeIds = nodeStatuses.map((ns: { nodeId: string }) => ns.nodeId);
      }

      const rangeMinutes = rangeMs[input.range] / 60000;

      const [pipelineRows, nodeRowsResult] = await Promise.all([
        prisma.pipelineMetric.findMany({
          where: {
            pipelineId: { in: effectivePipelineIds },
            componentId: null,
            timestamp: { gte: since },
            ...(input.groupBy === "node"
              ? { nodeId: { in: effectiveNodeIds } }
              : { nodeId: null }),
          },
          orderBy: { timestamp: "asc" },
          select: {
            pipelineId: true,
            nodeId: true,
            timestamp: true,
            eventsIn: true,
            eventsOut: true,
            bytesIn: true,
            bytesOut: true,
            errorsTotal: true,
            eventsDiscarded: true,
            latencyMeanMs: true,
          },
        }),
        effectiveNodeIds.length > 0
          ? queryNodeMetricsAggregated({
              nodeIds: effectiveNodeIds,
              minutes: rangeMinutes,
            })
          : { rows: [] },
      ]);

      const nodeRows = nodeRowsResult.rows;

      return computeChartMetrics({
        range: input.range,
        groupBy: input.groupBy,
        nodeNameMap,
        pipelineNameMap,
        pipelineRows,
        nodeRows,
        filterOptions: {
          nodes: allNodes.map((n: { id: string; name: string }) => ({ id: n.id, name: n.name })),
          pipelines: allPipelines.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })),
        },
      });
    }),

  /* ── Custom Dashboard Views CRUD ───────────────────────────────── */

  listViews: protectedProcedure.query(async ({ ctx }) => {
    return prisma.dashboardView.findMany({
      where: { userId: ctx.session.user!.id! },
      orderBy: { sortOrder: "asc" },
    });
  }),

  createView: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(50),
        panels: z.array(z.string()).min(1),
        filters: z
          .object({
            pipelineIds: z.array(z.string()).optional(),
            nodeIds: z.array(z.string()).optional(),
            layout: z
              .array(
                z.object({
                  i: z.string(),
                  x: z.number(),
                  y: z.number(),
                  w: z.number(),
                  h: z.number(),
                })
              )
              .optional(),
          })
          .optional(),
      })
    )
    .use(withTeamAccess("VIEWER"))
    .use(withAudit("dashboard.create_view", "DashboardView"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user!.id!;
      const maxOrder = await prisma.dashboardView.aggregate({
        where: { userId },
        _max: { sortOrder: true },
      });
      const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;
      return prisma.dashboardView.create({
        data: {
          userId,
          name: input.name,
          panels: input.panels,
          filters: input.filters ?? {},
          sortOrder: nextOrder,
        },
      });
    }),

  updateView: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(50).optional(),
        panels: z.array(z.string()).min(1).optional(),
        filters: z
          .object({
            pipelineIds: z.array(z.string()).optional(),
            nodeIds: z.array(z.string()).optional(),
            layout: z
              .array(
                z.object({
                  i: z.string(),
                  x: z.number(),
                  y: z.number(),
                  w: z.number(),
                  h: z.number(),
                })
              )
              .optional(),
          })
          .optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .use(withTeamAccess("VIEWER"))
    .use(withAudit("dashboard.update_view", "DashboardView"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user!.id!;
      const view = await prisma.dashboardView.findUnique({
        where: { id: input.id },
      });
      if (!view || view.userId !== userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, environmentId, ...data } = input;
      return prisma.dashboardView.update({ where: { id }, data });
    }),

  deleteView: protectedProcedure
    .input(z.object({ environmentId: z.string(), id: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .use(withAudit("dashboard.delete_view", "DashboardView"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user!.id!;
      const view = await prisma.dashboardView.findUnique({
        where: { id: input.id },
      });
      if (!view || view.userId !== userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await prisma.dashboardView.delete({ where: { id: input.id } });
      return { deleted: true };
    }),
});
