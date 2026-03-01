import { prisma } from "@/lib/prisma";

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

  await prisma.vectorNode.updateMany({
    where: {
      nodeTokenHash: { not: null },
      lastHeartbeat: { lt: maxAge },
      status: { not: "UNREACHABLE" },
    },
    data: { status: "UNREACHABLE" },
  });
}
