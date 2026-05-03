import { prisma } from "@/lib/prisma";

export interface ActiveTap {
  nodeId: string;
  pipelineId: string;
  componentId: string;
  startedAt: number;
}

export const TAP_TTL_MS = 5 * 60 * 1000;

/**
 * Persistent tap authorization state. Backed by Postgres so authorization
 * survives across server instances in HA deployments — the agent's `tap_start`
 * may land on instance A while subsequent `/tap-events` POSTs land on B.
 */

export async function setActiveTap(
  requestId: string,
  tap: { nodeId: string; pipelineId: string; componentId: string },
): Promise<void> {
  await prisma.activeTap.create({
    data: {
      requestId,
      nodeId: tap.nodeId,
      pipelineId: tap.pipelineId,
      componentId: tap.componentId,
      expiresAt: new Date(Date.now() + TAP_TTL_MS),
    },
  });
}

export async function getActiveTap(requestId: string): Promise<ActiveTap | null> {
  const row = await prisma.activeTap.findUnique({
    where: { requestId },
    select: {
      nodeId: true,
      pipelineId: true,
      componentId: true,
      startedAt: true,
      expiresAt: true,
    },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    // Treat as missing for the caller, but DON'T delete the row here —
    // the periodic sweeper (expireStaleTaps + cleanupStaleTaps) is the only
    // path that emits the tap_stop push back to the agent. Deleting eagerly
    // here would leave the agent tapping forever while every event POST 403s
    // until manual intervention.
    return null;
  }
  return {
    nodeId: row.nodeId,
    pipelineId: row.pipelineId,
    componentId: row.componentId,
    startedAt: row.startedAt.getTime(),
  };
}

export async function deleteActiveTap(requestId: string): Promise<ActiveTap | null> {
  // Use deleteMany so concurrent stops are idempotent — the second caller
  // gets count: 0 instead of a P2025 NotFound error. Read the row first so
  // we can echo the tap_stop push back to the agent.
  const existing = await prisma.activeTap.findUnique({
    where: { requestId },
    select: {
      nodeId: true,
      pipelineId: true,
      componentId: true,
      startedAt: true,
    },
  });
  if (!existing) return null;
  const { count } = await prisma.activeTap.deleteMany({ where: { requestId } });
  if (count === 0) return null;
  return {
    nodeId: existing.nodeId,
    pipelineId: existing.pipelineId,
    componentId: existing.componentId,
    startedAt: existing.startedAt.getTime(),
  };
}

export async function expireStaleTaps(): Promise<{ requestId: string; nodeId: string }[]> {
  const now = new Date();
  const stale = await prisma.activeTap.findMany({
    where: { expiresAt: { lte: now } },
    select: { requestId: true, nodeId: true },
  });
  if (stale.length === 0) return [];
  await prisma.activeTap.deleteMany({
    where: { requestId: { in: stale.map((s) => s.requestId) } },
  });
  return stale;
}
