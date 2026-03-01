import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";

export const dashboardRouter = router({
  stats: protectedProcedure.query(async () => {
    const [pipelineCount, nodeCount, environmentCount, healthyCounts] = await Promise.all([
      prisma.pipeline.count(),
      prisma.vectorNode.count(),
      prisma.environment.count(),
      prisma.vectorNode.groupBy({
        by: ["status"],
        _count: { status: true },
      }),
    ]);

    const healthy = healthyCounts.find((h) => h.status === "HEALTHY")?._count.status ?? 0;
    const degraded = healthyCounts.find((h) => h.status === "DEGRADED")?._count.status ?? 0;
    const unreachable = healthyCounts.find((h) => h.status === "UNREACHABLE")?._count.status ?? 0;

    return {
      pipelines: pipelineCount,
      nodes: nodeCount,
      environments: environmentCount,
      fleet: { healthy, degraded, unreachable },
    };
  }),

  recentPipelines: protectedProcedure.query(async () => {
    return prisma.pipeline.findMany({
      take: 5,
      orderBy: { updatedAt: "desc" },
      include: { environment: { select: { name: true } } },
    });
  }),

  recentAudit: protectedProcedure.query(async () => {
    return prisma.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true } } },
    });
  }),

  nodeCards: protectedProcedure.query(async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const nodes = await prisma.vectorNode.findMany({
      include: {
        environment: { select: { id: true, name: true } },
        pipelineStatuses: {
          include: {
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

    return nodes.map((node) => ({
      id: node.id,
      name: node.name,
      host: node.host,
      status: node.status,
      lastSeen: node.lastSeen,
      environment: node.environment,
      pipelines: node.pipelineStatuses.map((ps) => ({
        id: ps.pipelineId,
        name: ps.pipeline?.name ?? ps.pipelineId.slice(0, 8),
        status: ps.status,
        eventsIn: Number(ps.eventsIn ?? 0),
        eventsOut: Number(ps.eventsOut ?? 0),
        bytesIn: Number(ps.bytesIn ?? 0),
        bytesOut: Number(ps.bytesOut ?? 0),
      })),
      sparkline: (metricsByNode.get(node.id) ?? []).map((m) => ({
        t: m.timestamp.getTime(),
        mem: m.memoryTotalBytes ? Number(m.memoryUsedBytes) / Number(m.memoryTotalBytes) * 100 : 0,
        cpu: Number(m.cpuSecondsTotal ?? 0),
      })),
    }));
  }),

  pipelineCards: protectedProcedure.query(async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const pipelines = await prisma.pipeline.findMany({
      where: { isDraft: false, deployedAt: { not: null } },
      include: {
        environment: { select: { id: true, name: true } },
        nodeStatuses: {
          include: {
            node: { select: { id: true, name: true, status: true } },
          },
        },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true },
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

    return pipelines.map((p) => {
      const totalEventsIn = p.nodeStatuses.reduce((s, ns) => s + Number(ns.eventsIn ?? 0), 0);
      const totalEventsOut = p.nodeStatuses.reduce((s, ns) => s + Number(ns.eventsOut ?? 0), 0);
      const totalBytesIn = p.nodeStatuses.reduce((s, ns) => s + Number(ns.bytesIn ?? 0), 0);
      const totalBytesOut = p.nodeStatuses.reduce((s, ns) => s + Number(ns.bytesOut ?? 0), 0);

      return {
        id: p.id,
        name: p.name,
        environment: p.environment,
        deployedAt: p.deployedAt,
        latestVersion: p.versions[0]?.version ?? 0,
        nodes: p.nodeStatuses.map((ns) => ({
          id: ns.node.id,
          name: ns.node.name,
          status: ns.node.status,
          pipelineStatus: ns.status,
        })),
        totals: { eventsIn: totalEventsIn, eventsOut: totalEventsOut, bytesIn: totalBytesIn, bytesOut: totalBytesOut },
        sparkline: (metricsByPipeline.get(p.id) ?? []).map((m) => ({
          t: m.timestamp.getTime(),
          eventsIn: Number(m.eventsIn ?? 0),
          eventsOut: Number(m.eventsOut ?? 0),
        })),
      };
    });
  }),

  operationalOverview: protectedProcedure.query(async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    const [unhealthyNodes, deployedPipelines, recentMetrics] = await Promise.all([
      prisma.vectorNode.findMany({
        where: { status: { not: "HEALTHY" } },
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
        where: { isDraft: false, deployedAt: { not: null } },
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
});
