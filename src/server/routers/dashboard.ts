import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { prisma } from "@/lib/prisma";
import { metricStore } from "@/server/services/metric-store";
import { generateVectorYaml } from "@/lib/config-generator";
import { decryptNodeConfig } from "@/server/services/config-crypto";

export const dashboardRouter = router({
  stats: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const envFilter = { environment: { id: input.environmentId } };
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [pipelineCount, nodeCount, healthyCounts, reductionMetrics] = await Promise.all([
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
            timestamp: { gte: oneHourAgo },
            pipeline: { environmentId: input.environmentId },
          },
          _sum: {
            eventsIn: true,
            eventsOut: true,
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
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });

    let teamIdFilter: { teamId?: { in: string[] } } = {};
    if (!user?.isSuperAdmin) {
      const memberships = await prisma.teamMember.findMany({
        where: { userId },
        select: { teamId: true },
      });
      teamIdFilter = { teamId: { in: memberships.map((m) => m.teamId) } };
    }

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
    });

    // Fetch sparkline data: metrics for last hour per node
    const nodeIds = nodes.map((n) => n.id);
    const metrics = nodeIds.length > 0
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

    // Group metrics by node
    const metricsByNode = new Map<string, typeof metrics>();
    for (const m of metrics) {
      const arr = metricsByNode.get(m.nodeId) ?? [];
      arr.push(m);
      metricsByNode.set(m.nodeId, arr);
    }

    // Build per-node live rates from MetricStore
    const latestSamples = metricStore.getLatestAll();

    // Look up component kinds so we only count source for "in" and sink for "out"
    const allComponentNodes = await prisma.pipelineNode.findMany({
      select: { componentKey: true, kind: true },
    });
    const componentKindMap = new Map<string, string>();
    for (const cn of allComponentNodes) {
      componentKindMap.set(cn.componentKey, cn.kind);
    }

    // Resolve kind for a MetricStore key like "nodeId:my_source"
    function resolveKind(metricKey: string): string | undefined {
      const componentId = metricKey.split(":").slice(1).join(":");
      for (const [compKey, kind] of componentKindMap) {
        if (componentId.includes(compKey)) return kind;
      }
      return undefined;
    }

    return nodes.map((node) => {
      let pipelineCount = 0;
      let unhealthyPipelines = 0;
      let totalEventsIn = 0, totalEventsOut = 0;
      let totalBytesIn = 0, totalBytesOut = 0;
      let totalErrors = 0;
      let eventsInRate = 0, eventsOutRate = 0;
      let bytesInRate = 0, bytesOutRate = 0;
      let errorsRate = 0;

      for (const ps of node.pipelineStatuses) {
        pipelineCount++;
        totalEventsIn += Number(ps.eventsIn ?? 0);
        totalEventsOut += Number(ps.eventsOut ?? 0);
        totalBytesIn += Number(ps.bytesIn ?? 0);
        totalBytesOut += Number(ps.bytesOut ?? 0);
        totalErrors += Number(ps.errorsTotal ?? 0);
        if (ps.status !== "RUNNING") unhealthyPipelines++;
      }

      // Sum component-level rates for this node, scoped by kind
      for (const [key, sample] of latestSamples) {
        if (!key.startsWith(`${node.id}:`)) continue;
        const kind = resolveKind(key);
        if (kind === "SOURCE") {
          eventsInRate += sample.receivedEventsRate;
          bytesInRate += sample.receivedBytesRate;
        } else if (kind === "SINK") {
          eventsOutRate += sample.sentEventsRate;
          bytesOutRate += sample.sentBytesRate;
        }
        errorsRate += sample.errorsRate;
      }

      return {
        id: node.id,
        name: node.name,
        host: node.host,
        status: node.status,
        lastSeen: node.lastSeen,
        environment: node.environment,
        pipelineCount,
        unhealthyPipelines,
        rates: { eventsIn: eventsInRate, eventsOut: eventsOutRate, bytesIn: bytesInRate, bytesOut: bytesOutRate, errors: errorsRate },
        totals: { eventsIn: totalEventsIn, eventsOut: totalEventsOut, bytesIn: totalBytesIn, bytesOut: totalBytesOut, errors: totalErrors },
        sparkline: (metricsByNode.get(node.id) ?? []).map((m, i, arr) => {
          let cpu = 0;
          if (i > 0) {
            const prev = arr[i - 1];
            const totalDelta = m.cpuSecondsTotal - prev.cpuSecondsTotal;
            const idleDelta = m.cpuSecondsIdle - prev.cpuSecondsIdle;
            if (totalDelta > 0) {
              cpu = Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
            }
          }
          return {
            t: m.timestamp.getTime(),
            mem: m.memoryTotalBytes ? Number(m.memoryUsedBytes) / Number(m.memoryTotalBytes) * 100 : 0,
            cpu,
          };
        }),
      };
    });
  }),

  pipelineCards: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
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
    const metrics = pipelineIds.length > 0
      ? await prisma.pipelineMetric.findMany({
          where: {
            pipelineId: { in: pipelineIds },
            nodeId: null,
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

    const metricsByPipeline = new Map<string, typeof metrics>();
    for (const m of metrics) {
      const arr = metricsByPipeline.get(m.pipelineId) ?? [];
      arr.push(m);
      metricsByPipeline.set(m.pipelineId, arr);
    }

    // Build per-pipeline rates from MetricStore by aggregating across nodes
    const latestSamplesForPipelines = metricStore.getLatestAll();

    // Map componentKey → { pipelineId, kind } using pipeline nodes
    const pipelineComponentNodes = await prisma.pipelineNode.findMany({
      where: { pipelineId: { in: pipelineIds } },
      select: { pipelineId: true, componentKey: true, kind: true },
    });
    const componentToPipeline = new Map<string, { pipelineId: string; kind: string }>();
    for (const pn of pipelineComponentNodes) {
      componentToPipeline.set(pn.componentKey, { pipelineId: pn.pipelineId, kind: pn.kind });
    }

    // Aggregate rates per pipeline, scoped by kind
    const pipelineRates = new Map<string, { eventsIn: number; eventsOut: number; bytesIn: number; bytesOut: number; errors: number }>();
    for (const [key, sample] of latestSamplesForPipelines) {
      const componentId = key.split(":").slice(1).join(":");
      for (const [compKey, info] of componentToPipeline) {
        if (componentId.includes(compKey)) {
          const existing = pipelineRates.get(info.pipelineId) ?? { eventsIn: 0, eventsOut: 0, bytesIn: 0, bytesOut: 0, errors: 0 };
          if (info.kind === "SOURCE") {
            existing.eventsIn += sample.receivedEventsRate;
            existing.bytesIn += sample.receivedBytesRate;
          } else if (info.kind === "SINK") {
            existing.eventsOut += sample.sentEventsRate;
            existing.bytesOut += sample.sentBytesRate;
          }
          existing.errors += sample.errorsRate;
          pipelineRates.set(info.pipelineId, existing);
          break;
        }
      }
    }

    return pipelines.map((p) => {
      const rates = pipelineRates.get(p.id) ?? { eventsIn: 0, eventsOut: 0, bytesIn: 0, bytesOut: 0, errors: 0 };
      const totalEventsIn = p.nodeStatuses.reduce((s, ns) => s + Number(ns.eventsIn ?? 0), 0);
      const totalEventsOut = p.nodeStatuses.reduce((s, ns) => s + Number(ns.eventsOut ?? 0), 0);
      const totalBytesIn = p.nodeStatuses.reduce((s, ns) => s + Number(ns.bytesIn ?? 0), 0);
      const totalBytesOut = p.nodeStatuses.reduce((s, ns) => s + Number(ns.bytesOut ?? 0), 0);
      const totalErrors = p.nodeStatuses.reduce((s, ns) => s + Number(ns.errorsTotal ?? 0), 0);

      // Detect saved-but-undeployed changes by comparing current YAML to latest version
      let hasUndeployedChanges = false;
      const latestVersion = p.versions[0];
      if (latestVersion?.configYaml) {
        try {
          const decryptedNodes = p.nodes.map((n) => ({
            ...n,
            config: decryptNodeConfig(
              n.componentType,
              (n.config as Record<string, unknown>) ?? {},
            ),
          }));
          const flowNodes = decryptedNodes.map((n) => ({
            id: n.id,
            type: n.kind.toLowerCase(),
            position: { x: n.positionX, y: n.positionY },
            data: {
              componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
              componentKey: n.componentKey,
              config: n.config as Record<string, unknown>,
              disabled: n.disabled,
            },
          }));
          const flowEdges = p.edges.map((e) => ({
            id: e.id,
            source: e.sourceNodeId,
            target: e.targetNodeId,
            ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
          }));
          const currentYaml = generateVectorYaml(
            flowNodes as Parameters<typeof generateVectorYaml>[0],
            flowEdges as Parameters<typeof generateVectorYaml>[1],
            p.globalConfig as Record<string, unknown> | null,
          );
          hasUndeployedChanges = currentYaml !== latestVersion.configYaml;

          // Also check log level changes (matches pipeline.ts logic)
          if (!hasUndeployedChanges) {
            const currentLogLevel = (p.globalConfig as Record<string, unknown>)?.log_level ?? null;
            const deployedLogLevel = (latestVersion as { logLevel?: string | null }).logLevel ?? null;
            if (currentLogLevel !== deployedLogLevel) {
              hasUndeployedChanges = true;
            }
          }
        } catch {
          hasUndeployedChanges = false;
        }
      } else if (latestVersion && !latestVersion.configYaml) {
        // Version exists but no configYaml — treat as changed
        hasUndeployedChanges = true;
      }

      return {
        id: p.id,
        name: p.name,
        environment: p.environment,
        deployedAt: p.deployedAt,
        latestVersion: p.versions[0]?.version ?? 0,
        hasUndeployedChanges,
        nodes: p.nodeStatuses.map((ns) => ({
          id: ns.node.id,
          name: ns.node.name,
          status: ns.node.status,
          pipelineStatus: ns.status,
        })),
        rates,
        totals: { eventsIn: totalEventsIn, eventsOut: totalEventsOut, bytesIn: totalBytesIn, bytesOut: totalBytesOut, errors: totalErrors },
        sparkline: (metricsByPipeline.get(p.id) ?? []).map((m) => ({
          t: m.timestamp.getTime(),
          eventsIn: Number(m.eventsIn ?? 0) / 60,
          eventsOut: Number(m.eventsOut ?? 0) / 60,
        })),
      };
    });
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
          timestamp: { gte: since },
        },
        _sum: { eventsIn: true, eventsOut: true, bytesIn: true, bytesOut: true },
      });

      // Previous period for trend comparison
      const previous = await prisma.pipelineMetric.aggregate({
        where: {
          pipeline: { environmentId: input.environmentId },
          timestamp: { gte: prevSince, lt: since },
        },
        _sum: { eventsIn: true, eventsOut: true, bytesIn: true, bytesOut: true },
      });

      // Per-pipeline breakdown
      const byPipeline = await prisma.pipelineMetric.groupBy({
        by: ["pipelineId"],
        where: {
          pipeline: { environmentId: input.environmentId },
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

      // Time series for volume chart — bucket raw metrics in JS for portability
      const bucketMs =
        hours <= 1 ? 60000 : hours <= 6 ? 300000 : hours <= 24 ? 900000 : hours <= 168 ? 3600000 : 14400000;

      // Cap at 50 000 rows to prevent OOM on large 30d windows. With desc
      // ordering, the most recent data is preserved; older buckets at the
      // start of the window are the ones dropped if the cap is hit.
      const rawMetrics = await prisma.pipelineMetric.findMany({
        where: {
          pipeline: { environmentId: input.environmentId },
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

      const timeSeries = Array.from(buckets.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([t, b]) => ({
          bucket: new Date(t).toISOString(),
          bytesIn: b.bytesIn,
          bytesOut: b.bytesOut,
          eventsIn: b.eventsIn,
          eventsOut: b.eventsOut,
        }));

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

      const [pipelineRows, nodeRows] = await Promise.all([
        prisma.pipelineMetric.findMany({
          where: {
            pipelineId: { in: effectivePipelineIds },
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
          },
        }),
        effectiveNodeIds.length > 0
          ? prisma.nodeMetric.findMany({
              where: {
                nodeId: { in: effectiveNodeIds },
                timestamp: { gte: since },
              },
              orderBy: { timestamp: "asc" },
              select: {
                nodeId: true,
                timestamp: true,
                cpuSecondsTotal: true,
                cpuSecondsIdle: true,
                memoryUsedBytes: true,
                memoryTotalBytes: true,
                diskReadBytes: true,
                diskWrittenBytes: true,
                netRxBytes: true,
                netTxBytes: true,
              },
            })
          : [],
      ]);

      type TSMap = Record<string, { t: number; v: number }[]>;

      const bucketMs = input.range === "7d" ? 5 * 60 * 1000 : 0;

      function addPoint(map: TSMap, label: string, t: number, v: number) {
        if (!map[label]) map[label] = [];
        map[label].push({ t, v });
      }

      function downsample(map: TSMap): TSMap {
        if (bucketMs === 0) return map;
        const result: TSMap = {};
        for (const [label, points] of Object.entries(map)) {
          const buckets = new Map<number, { sum: number; count: number }>();
          for (const p of points) {
            const bucket = Math.floor(p.t / bucketMs) * bucketMs;
            const b = buckets.get(bucket) ?? { sum: 0, count: 0 };
            b.sum += p.v;
            b.count++;
            buckets.set(bucket, b);
          }
          result[label] = Array.from(buckets.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([t, b]) => ({ t, v: b.sum / b.count }));
        }
        return result;
      }

      const eventsIn: TSMap = {};
      const eventsOut: TSMap = {};
      const bytesIn: TSMap = {};
      const bytesOut: TSMap = {};
      const errors: TSMap = {};
      const discarded: TSMap = {};

      if (input.groupBy === "node") {
        // Sum pipeline values per (node, timestamp) since multiple pipelines on one node produce multiple rows
        const acc = new Map<string, Map<number, { ei: number; eo: number; bi: number; bo: number; er: number; di: number }>>();
        for (const row of pipelineRows) {
          const label = nodeNameMap.get(row.nodeId ?? "") ?? row.nodeId ?? "unknown";
          const t = new Date(row.timestamp).getTime();
          if (!acc.has(label)) acc.set(label, new Map());
          const timeMap = acc.get(label)!;
          const s = timeMap.get(t) ?? { ei: 0, eo: 0, bi: 0, bo: 0, er: 0, di: 0 };
          s.ei += Number(row.eventsIn) / 60;
          s.eo += Number(row.eventsOut) / 60;
          s.bi += Number(row.bytesIn) / 60;
          s.bo += Number(row.bytesOut) / 60;
          s.er += Number(row.errorsTotal) / 60;
          s.di += Number(row.eventsDiscarded) / 60;
          timeMap.set(t, s);
        }
        for (const [label, timeMap] of acc) {
          for (const [t, s] of timeMap) {
            addPoint(eventsIn, label, t, s.ei);
            addPoint(eventsOut, label, t, s.eo);
            addPoint(bytesIn, label, t, s.bi);
            addPoint(bytesOut, label, t, s.bo);
            addPoint(errors, label, t, s.er);
            addPoint(discarded, label, t, s.di);
          }
        }
      } else if (input.groupBy === "aggregate") {
        // Sum all pipelines into a single "Total" series per timestamp
        const acc = new Map<number, { ei: number; eo: number; bi: number; bo: number; er: number; di: number }>();
        for (const row of pipelineRows) {
          const t = new Date(row.timestamp).getTime();
          const s = acc.get(t) ?? { ei: 0, eo: 0, bi: 0, bo: 0, er: 0, di: 0 };
          s.ei += Number(row.eventsIn) / 60;
          s.eo += Number(row.eventsOut) / 60;
          s.bi += Number(row.bytesIn) / 60;
          s.bo += Number(row.bytesOut) / 60;
          s.er += Number(row.errorsTotal) / 60;
          s.di += Number(row.eventsDiscarded) / 60;
          acc.set(t, s);
        }
        for (const [t, s] of acc) {
          addPoint(eventsIn, "Total", t, s.ei);
          addPoint(eventsOut, "Total", t, s.eo);
          addPoint(bytesIn, "Total", t, s.bi);
          addPoint(bytesOut, "Total", t, s.bo);
          addPoint(errors, "Total", t, s.er);
          addPoint(discarded, "Total", t, s.di);
        }
      } else {
        // groupBy === "pipeline" — direct mapping, one series per pipeline
        for (const row of pipelineRows) {
          const label = pipelineNameMap.get(row.pipelineId) ?? row.pipelineId;
          const t = new Date(row.timestamp).getTime();
          addPoint(eventsIn, label, t, Number(row.eventsIn) / 60);
          addPoint(eventsOut, label, t, Number(row.eventsOut) / 60);
          addPoint(bytesIn, label, t, Number(row.bytesIn) / 60);
          addPoint(bytesOut, label, t, Number(row.bytesOut) / 60);
          addPoint(errors, label, t, Number(row.errorsTotal) / 60);
          addPoint(discarded, label, t, Number(row.eventsDiscarded) / 60);
        }
      }

      const cpu: TSMap = {};
      const memory: TSMap = {};
      const diskRead: TSMap = {};
      const diskWrite: TSMap = {};
      const netRx: TSMap = {};
      const netTx: TSMap = {};

      type NodeRow = {
        nodeId: string;
        timestamp: Date;
        cpuSecondsTotal: number;
        cpuSecondsIdle: number;
        memoryUsedBytes: bigint;
        memoryTotalBytes: bigint;
        diskReadBytes: bigint;
        diskWrittenBytes: bigint;
        netRxBytes: bigint;
        netTxBytes: bigint;
      };
      const nodeRowsByNode = new Map<string, NodeRow[]>();
      for (const row of nodeRows as NodeRow[]) {
        const arr = nodeRowsByNode.get(row.nodeId) ?? [];
        arr.push(row);
        nodeRowsByNode.set(row.nodeId, arr);
      }

      for (const [nodeId, rows] of nodeRowsByNode) {
        const label = nodeNameMap.get(nodeId) ?? nodeId;
        for (let i = 1; i < rows.length; i++) {
          const prev = rows[i - 1];
          const curr = rows[i];
          const t = new Date(curr.timestamp).getTime();
          const dtSec = (t - new Date(prev.timestamp).getTime()) / 1000;
          if (dtSec <= 0) continue;

          const cpuTotalDelta = curr.cpuSecondsTotal - prev.cpuSecondsTotal;
          const cpuIdleDelta = curr.cpuSecondsIdle - prev.cpuSecondsIdle;
          const cpuPct = cpuTotalDelta > 0
            ? Math.max(0, Math.min(100, ((cpuTotalDelta - cpuIdleDelta) / cpuTotalDelta) * 100))
            : 0;
          addPoint(cpu, label, t, cpuPct);

          const memTotal = Number(curr.memoryTotalBytes);
          const memUsed = Number(curr.memoryUsedBytes);
          addPoint(memory, label, t, memTotal > 0 ? (memUsed / memTotal) * 100 : 0);

          const dr = (Number(curr.diskReadBytes) - Number(prev.diskReadBytes)) / dtSec;
          const dw = (Number(curr.diskWrittenBytes) - Number(prev.diskWrittenBytes)) / dtSec;
          addPoint(diskRead, label, t, Math.max(0, dr));
          addPoint(diskWrite, label, t, Math.max(0, dw));

          const rx = (Number(curr.netRxBytes) - Number(prev.netRxBytes)) / dtSec;
          const tx = (Number(curr.netTxBytes) - Number(prev.netTxBytes)) / dtSec;
          addPoint(netRx, label, t, Math.max(0, rx));
          addPoint(netTx, label, t, Math.max(0, tx));
        }
      }

      // For aggregate grouping, collapse system metrics into single "Total" series
      if (input.groupBy === "aggregate") {
        function avgSeries(map: TSMap): TSMap {
          const acc = new Map<number, { sum: number; count: number }>();
          for (const points of Object.values(map)) {
            for (const p of points) {
              const s = acc.get(p.t) ?? { sum: 0, count: 0 };
              s.sum += p.v;
              s.count++;
              acc.set(p.t, s);
            }
          }
          const sorted = Array.from(acc.entries()).sort((a, b) => a[0] - b[0]);
          return { Total: sorted.map(([t, s]) => ({ t, v: s.sum / s.count })) };
        }
        function sumSeries(map: TSMap): TSMap {
          const acc = new Map<number, number>();
          for (const points of Object.values(map)) {
            for (const p of points) {
              acc.set(p.t, (acc.get(p.t) ?? 0) + p.v);
            }
          }
          const sorted = Array.from(acc.entries()).sort((a, b) => a[0] - b[0]);
          return { Total: sorted.map(([t, v]) => ({ t, v })) };
        }

        // CPU & memory: average across nodes. Disk & network: sum rates.
        const cpuAgg = avgSeries(cpu);
        const memAgg = avgSeries(memory);
        const drAgg = sumSeries(diskRead);
        const dwAgg = sumSeries(diskWrite);
        const rxAgg = sumSeries(netRx);
        const txAgg = sumSeries(netTx);

        // Clear and replace
        for (const key of Object.keys(cpu)) delete cpu[key];
        Object.assign(cpu, cpuAgg);
        for (const key of Object.keys(memory)) delete memory[key];
        Object.assign(memory, memAgg);
        for (const key of Object.keys(diskRead)) delete diskRead[key];
        Object.assign(diskRead, drAgg);
        for (const key of Object.keys(diskWrite)) delete diskWrite[key];
        Object.assign(diskWrite, dwAgg);
        for (const key of Object.keys(netRx)) delete netRx[key];
        Object.assign(netRx, rxAgg);
        for (const key of Object.keys(netTx)) delete netTx[key];
        Object.assign(netTx, txAgg);
      }

      return {
        pipeline: {
          eventsIn: downsample(eventsIn),
          eventsOut: downsample(eventsOut),
          bytesIn: downsample(bytesIn),
          bytesOut: downsample(bytesOut),
          errors: downsample(errors),
          discarded: downsample(discarded),
        },
        system: {
          cpu: downsample(cpu),
          memory: downsample(memory),
          diskRead: downsample(diskRead),
          diskWrite: downsample(diskWrite),
          netRx: downsample(netRx),
          netTx: downsample(netTx),
        },
        filterOptions: {
          nodes: allNodes.map((n: { id: string; name: string }) => ({ id: n.id, name: n.name })),
          pipelines: allPipelines.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })),
        },
      };
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
