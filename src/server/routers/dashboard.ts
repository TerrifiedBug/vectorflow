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
});
