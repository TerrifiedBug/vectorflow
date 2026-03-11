import { prisma } from "@/lib/prisma";
import { fireEventAlert } from "./event-alerts";

/**
 * Check all agent-enrolled nodes and mark unhealthy if heartbeat exceeded threshold.
 */
export async function checkNodeHealth(): Promise<void> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { fleetPollIntervalMs: true, fleetUnhealthyThreshold: true },
  });

  const pollMs = settings?.fleetPollIntervalMs ?? 15000;
  const threshold = settings?.fleetUnhealthyThreshold ?? 3;
  const maxAge = new Date(Date.now() - pollMs * threshold);

  // Find nodes that are about to become unreachable so we can fire alerts
  const goingUnreachable = await prisma.vectorNode.findMany({
    where: {
      nodeTokenHash: { not: null },
      lastHeartbeat: { lt: maxAge },
      status: { not: "UNREACHABLE" },
    },
    select: { id: true, name: true, environmentId: true, status: true },
  });

  if (goingUnreachable.length > 0) {
    await prisma.nodeStatusEvent.createMany({
      data: goingUnreachable.map((node) => ({
        nodeId: node.id,
        fromStatus: node.status,
        toStatus: "UNREACHABLE",
        reason: "heartbeat timeout",
      })),
    });
  }

  await prisma.vectorNode.updateMany({
    where: {
      nodeTokenHash: { not: null },
      lastHeartbeat: { lt: maxAge },
      status: { not: "UNREACHABLE" },
    },
    data: { status: "UNREACHABLE" },
  });

  for (const node of goingUnreachable) {
    void fireEventAlert("node_left", node.environmentId, {
      message: `Node "${node.name}" is unreachable`,
      nodeId: node.id,
    });
  }
}
