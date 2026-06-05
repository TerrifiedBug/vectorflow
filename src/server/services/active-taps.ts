import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { withOrgTx } from "@/lib/with-org-tx";

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
  tap: {
    nodeId: string;
    pipelineId: string;
    componentId: string;
    /** Tenant scope persisted on the tap row. REQUIRED — silently
     *  defaulting to "default" silently mis-tags non-default-org taps
     *  and breaks RLS once `app.org_id` is set. Caller MUST pass the
     *  resolved org id. */
    organizationId: string;
  },
): Promise<void> {
  if (!tap.organizationId) {
    throw new Error("setActiveTap: organizationId is required");
  }
  await prisma.activeTap.create({
    data: {
      requestId,
      nodeId: tap.nodeId,
      pipelineId: tap.pipelineId,
      componentId: tap.componentId,
      organizationId: tap.organizationId,
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

export interface SaveTapCaptureInput {
  /** Tenant scope — REQUIRED so the insert runs under the caller's org
   *  (app.org_id) and RLS. */
  organizationId: string;
  pipelineId: string;
  /** Human-supplied label for the saved capture. */
  name: string;
  /** Component the events were tapped/sampled from. */
  componentKey: string;
  /** The captured events to persist. */
  events: unknown[];
  /** Optional inferred schema for the events (defaults to {}). */
  schema?: unknown;
  /** User who saved the capture, if known. */
  createdById?: string | null;
}

export interface SavedTapCaptureSummary {
  id: string;
  name: string;
  componentKey: string;
  eventCount: number;
  createdAt: Date;
}

/**
 * Persist a set of tapped/sampled events as a named `TapCapture`, retained
 * beyond the ephemeral tap / `EventSample` TTL so it can later be replayed
 * through the transform-eval harness (the live-tap iteration loop). The
 * insert runs inside `withOrgTx` so `app.org_id` is set for RLS. Returns a
 * lightweight summary rather than the full events blob.
 *
 * Shared by `tapCapture.create` and `pipeline.saveTapCapture` so the two
 * surfaces (capture management vs. tap-native save) persist identically.
 */
export async function saveTapCapture(
  input: SaveTapCaptureInput,
): Promise<SavedTapCaptureSummary> {
  if (!input.organizationId) {
    throw new Error("saveTapCapture: organizationId is required");
  }
  const eventCount = input.events.length;
  return withOrgTx(input.organizationId, async (tx) => {
    const created = await tx.tapCapture.create({
      data: {
        organizationId: input.organizationId,
        pipelineId: input.pipelineId,
        name: input.name,
        componentKey: input.componentKey,
        events: input.events as Prisma.InputJsonValue,
        schema: (input.schema ?? {}) as Prisma.InputJsonValue,
        eventCount,
        createdById: input.createdById ?? null,
      },
      select: {
        id: true,
        name: true,
        componentKey: true,
        eventCount: true,
        createdAt: true,
      },
    });
    return created;
  });
}
