import { prisma } from "@/lib/prisma";
import { apiRoute, jsonResponse } from "../../_lib/api-handler";

export const GET = apiRoute(
  "nodes.read",
  async (_req, ctx) => {
    const nodes = await prisma.vectorNode.findMany({
      where: { environmentId: ctx.environmentId },
      select: { id: true, status: true, maintenanceMode: true },
    });

    const pipelines = await prisma.pipeline.findMany({
      where: { environmentId: ctx.environmentId },
      select: { id: true, isDraft: true },
    });

    const statusCounts: Record<string, number> = {};
    let maintenanceCount = 0;
    for (const node of nodes) {
      statusCounts[node.status] = (statusCounts[node.status] ?? 0) + 1;
      if (node.maintenanceMode) maintenanceCount++;
    }

    return jsonResponse({
      fleet: {
        totalNodes: nodes.length,
        nodesByStatus: statusCounts,
        nodesInMaintenance: maintenanceCount,
        totalPipelines: pipelines.length,
        deployedPipelines: pipelines.filter((p) => !p.isDraft).length,
        draftPipelines: pipelines.filter((p) => p.isDraft).length,
      },
    });
  },
  "read",
);
