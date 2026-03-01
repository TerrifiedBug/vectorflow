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

  operationalOverview: protectedProcedure.query(async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    const [unhealthyNodes, deployedPipelines, recentMetrics] = await Promise.all([
      prisma.vectorNode.findMany({
        where: { status: { not: "HEALTHY" } },
        select: {
          id: true,
          name: true,
          hostname: true,
          status: true,
          lastSeenAt: true,
          environment: { select: { name: true } },
        },
        orderBy: { lastSeenAt: "desc" },
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
