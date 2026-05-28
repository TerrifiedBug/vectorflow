import { prisma } from "@/lib/prisma";
import { getOrgSettings } from "@/lib/org-settings";
import { fireEventAlert } from "./event-alerts";

/**
 * Check every organisation's agent-enrolled nodes and mark them UNREACHABLE
 * when their heartbeat has exceeded that org's threshold.
 *
 * Each organisation is evaluated against ITS OWN fleet poll interval and
 * unhealthy threshold — previously the function used DEFAULT_ORG_ID's settings
 * for the whole installation and ran an un-org-scoped query, so in a
 * multi-tenant deployment every tenant's fleet was judged by one org's config.
 */
export async function checkNodeHealth(): Promise<void> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    await checkOrgNodeHealth(org.id);
  }
}

/** Evaluate a single organisation's fleet against its own thresholds. */
export async function checkOrgNodeHealth(organizationId: string): Promise<void> {
  const settings = await getOrgSettings(organizationId);

  const pollMs = settings.fleetPollIntervalMs ?? 15000;
  const threshold = settings.fleetUnhealthyThreshold ?? 3;
  const maxAge = new Date(Date.now() - pollMs * threshold);

  const staleWhere = {
    organizationId,
    nodeTokenHash: { not: null },
    lastHeartbeat: { lt: maxAge },
    status: { not: "UNREACHABLE" },
  } as const;

  // Find nodes that are about to become unreachable so we can fire alerts
  const goingUnreachable = await prisma.vectorNode.findMany({
    where: staleWhere,
    select: { id: true, name: true, environmentId: true, status: true },
  });

  if (goingUnreachable.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.nodeStatusEvent.createMany({
        data: goingUnreachable.map((node) => ({
          nodeId: node.id,
          fromStatus: node.status,
          toStatus: "UNREACHABLE",
          reason: "heartbeat timeout",
        })),
      });
      await tx.vectorNode.updateMany({
        where: staleWhere,
        data: { status: "UNREACHABLE" },
      });
    });
  }

  for (const node of goingUnreachable) {
    void fireEventAlert("node_left", node.environmentId, {
      message: `Node "${node.name}" is unreachable`,
      nodeId: node.id,
    });
  }
}
