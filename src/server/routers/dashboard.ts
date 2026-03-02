import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { metricStore } from "@/server/services/metric-store";

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

      // Sum component-level rates for this node
      for (const [key, sample] of latestSamples) {
        if (!key.startsWith(`${node.id}:`)) continue;
        eventsInRate += sample.receivedEventsRate;
        eventsOutRate += sample.sentEventsRate;
        bytesInRate += sample.receivedBytesRate;
        bytesOutRate += sample.sentBytesRate;
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
        sparkline: (metricsByNode.get(node.id) ?? []).map((m) => ({
          t: m.timestamp.getTime(),
          mem: m.memoryTotalBytes ? Number(m.memoryUsedBytes) / Number(m.memoryTotalBytes) * 100 : 0,
          cpu: Number(m.cpuSecondsTotal ?? 0),
        })),
      };
    });
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

    // Build per-pipeline rates from MetricStore by aggregating across nodes
    const latestSamplesForPipelines = metricStore.getLatestAll();

    // Map componentId → pipelineId using pipeline nodes
    const allPipelineNodes = await prisma.pipelineNode.findMany({
      where: { pipelineId: { in: pipelineIds } },
      select: { pipelineId: true, componentKey: true },
    });
    const componentToPipeline = new Map<string, string>();
    for (const pn of allPipelineNodes) {
      componentToPipeline.set(pn.componentKey, pn.pipelineId);
    }

    // Aggregate rates per pipeline
    const pipelineRates = new Map<string, { eventsIn: number; eventsOut: number; bytesIn: number; bytesOut: number; errors: number }>();
    for (const [key, sample] of latestSamplesForPipelines) {
      const componentId = key.split(":").slice(1).join(":");
      // Match by checking if any pipeline node's componentKey is in the componentId
      for (const [compKey, pipeId] of componentToPipeline) {
        if (componentId.includes(compKey)) {
          const existing = pipelineRates.get(pipeId) ?? { eventsIn: 0, eventsOut: 0, bytesIn: 0, bytesOut: 0, errors: 0 };
          existing.eventsIn += sample.receivedEventsRate;
          existing.eventsOut += sample.sentEventsRate;
          existing.bytesIn += sample.receivedBytesRate;
          existing.bytesOut += sample.sentBytesRate;
          existing.errors += sample.errorsRate;
          pipelineRates.set(pipeId, existing);
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
