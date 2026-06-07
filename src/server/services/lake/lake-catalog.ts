import yaml from "js-yaml";
import { prisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import { errorLog } from "@/lib/logger";
import { configHasLakeSink, LAKE_SINK_TYPE } from "@/lib/vector/lake-sink";
import { isLakeEnabled } from "./clickhouse";
import {
  clamp,
  splitLakeOutput,
  type MetricsDataPoint,
  type PreviousSnapshot,
} from "@/server/services/metrics-ingest";

/**
 * VectorFlow Lake catalog upkeep (A2).
 *
 * The events themselves live in ClickHouse `lake_events`; this Postgres-side
 * `LakeDataset` row is the catalog the search UI and ops read to reason about a
 * pipeline's lake data (row/byte counts, time range, discovered schema) without
 * touching ClickHouse. Everything here is tenant-scoped (`withOrgTx`) and a
 * no-op when the lake is disabled.
 */

export interface UpsertLakeDatasetInput {
  orgId: string;
  pipelineId: string;
  environmentId: string;
}

/** Ensure a `LakeDataset` catalog row exists for (orgId, pipelineId). Idempotent. */
export async function upsertLakeDataset({
  orgId,
  pipelineId,
  environmentId,
}: UpsertLakeDatasetInput): Promise<void> {
  await withOrgTx(orgId, (tx) =>
    tx.lakeDataset.upsert({
      where: { organizationId_pipelineId: { organizationId: orgId, pipelineId } },
      create: { organizationId: orgId, pipelineId, environmentId },
      update: { environmentId },
    }),
  );
}

export interface RecordLakeIngestInput {
  orgId: string;
  pipelineId: string;
  rowsAdded: bigint;
  bytesAdded: bigint;
  firstEventAt?: Date;
  lastEventAt?: Date;
  schema?: Record<string, string>;
}

/**
 * Fold a heartbeat's worth of lake writes into the catalog row: add to the
 * row/byte counts, widen `[firstEventAt, lastEventAt]`, and merge any newly
 * discovered fields into `schemaJson`. The read + update run in one tenant
 * transaction so concurrent heartbeats can't lose an increment. Requires the
 * row to exist — call `upsertLakeDataset` first.
 */
export async function recordLakeIngest(input: RecordLakeIngestInput): Promise<void> {
  const { orgId, pipelineId, rowsAdded, bytesAdded, firstEventAt, lastEventAt, schema } = input;
  await withOrgTx(orgId, async (tx) => {
    const existing = await tx.lakeDataset.findUnique({
      where: { organizationId_pipelineId: { organizationId: orgId, pipelineId } },
    });
    // No catalog row yet — upsertLakeDataset is the creator (it has the
    // environmentId we lack here), so skip rather than fabricate a partial row.
    if (!existing) return;

    const existingSchema =
      existing.schemaJson &&
      typeof existing.schemaJson === "object" &&
      !Array.isArray(existing.schemaJson)
        ? (existing.schemaJson as Record<string, string>)
        : {};

    await tx.lakeDataset.update({
      where: { organizationId_pipelineId: { organizationId: orgId, pipelineId } },
      data: {
        rowCount: existing.rowCount + rowsAdded,
        byteCount: existing.byteCount + bytesAdded,
        firstEventAt:
          firstEventAt && (!existing.firstEventAt || firstEventAt < existing.firstEventAt)
            ? firstEventAt
            : existing.firstEventAt,
        lastEventAt:
          lastEventAt && (!existing.lastEventAt || lastEventAt > existing.lastEventAt)
            ? lastEventAt
            : existing.lastEventAt,
        ...(schema ? { schemaJson: { ...existingSchema, ...schema } } : {}),
      },
    });
  });
}

export interface LakeCatalogHeartbeatInput {
  orgId: string;
  environmentId: string;
  dataPoints: MetricsDataPoint[];
  previousSnapshots?: Map<string, PreviousSnapshot>;
}

/** Per-component heartbeat metric subset needed to attribute Lake-sink output. */
export interface LakeComponentMetric {
  componentId: string;
  componentKind: string;
  sentEvents: number;
  sentBytes?: number;
}

/**
 * Stamp each reporting pipeline's managed Lake sink output (cumulative
 * sentEvents/sentBytes) onto the matching MetricsDataPoint, so metrics ingestion
 * can split user egress from Lake-only writes. The Lake sink's Vector component
 * id equals its `pipelineNode.componentKey` (the YAML generator emits the key
 * verbatim), so we sum the `sink`-kind componentMetrics whose id is one of the
 * pipeline's `vectorflow_lake` node keys. Mutates `dataPoints` in place; a no-op
 * for pipelines with no Lake node or no componentMetrics (those keep their full
 * output as egress — graceful for pre-componentMetrics agents). Gate the call on
 * `isLakeEnabled()`.
 */
export async function attachLakeSinkOutput(
  dataPoints: MetricsDataPoint[],
  pipelines: ReadonlyArray<{
    pipelineId: string;
    componentMetrics?: readonly LakeComponentMetric[];
  }>,
): Promise<void> {
  if (dataPoints.length === 0) return;
  const pipelineIds = [...new Set(dataPoints.map((d) => d.pipelineId))];
  const lakeNodes = await prisma.pipelineNode.findMany({
    where: { pipelineId: { in: pipelineIds }, componentType: LAKE_SINK_TYPE },
    select: { pipelineId: true, componentKey: true },
  });
  if (lakeNodes.length === 0) return;

  const lakeKeysByPipeline = new Map<string, Set<string>>();
  for (const node of lakeNodes) {
    let keys = lakeKeysByPipeline.get(node.pipelineId);
    if (!keys) {
      keys = new Set<string>();
      lakeKeysByPipeline.set(node.pipelineId, keys);
    }
    keys.add(node.componentKey);
  }

  const componentsByPipeline = new Map<string, readonly LakeComponentMetric[]>();
  for (const p of pipelines) {
    if (p.componentMetrics) componentsByPipeline.set(p.pipelineId, p.componentMetrics);
  }

  for (const dp of dataPoints) {
    const lakeKeys = lakeKeysByPipeline.get(dp.pipelineId);
    if (!lakeKeys) continue;
    const components = componentsByPipeline.get(dp.pipelineId);
    if (!components) continue;
    let events = 0;
    let bytes = 0;
    for (const cm of components) {
      if (cm.componentKind === "sink" && lakeKeys.has(cm.componentId)) {
        events += cm.sentEvents;
        bytes += cm.sentBytes ?? 0;
      }
    }
    dp.lakeEventsOut = BigInt(Math.max(0, Math.round(events)));
    dp.lakeBytesOut = BigInt(Math.max(0, Math.round(bytes)));
  }
}

/**
 * In-memory debounce buffer for lake-catalog writes (SC-5). Heartbeats fold
 * their per-pipeline Lake deltas here and flush at most once per
 * LAKE_CATALOG_FLUSH_MS window, instead of an upsert + update transaction on
 * every heartbeat. A lost buffer (restart) only delays a catalog refresh — the
 * counts are re-derived from the next heartbeat's cumulative deltas.
 */
interface PendingLakeWrite {
  environmentId: string;
  rows: bigint;
  bytes: bigint;
  firstEventAt: Date;
  lastEventAt: Date;
  firstSeenAt: number;
}
const pendingLakeWrites = new Map<string, PendingLakeWrite>();

/** Test seam: clear the debounce buffer between cases. */
export function __resetLakeCatalogBuffer(): void {
  pendingLakeWrites.clear();
}

/**
 * Heartbeat hook: refresh the lake catalog for every reporting pipeline that
 * routes to the managed lake sink. No-op unless the lake is enabled. Records the
 * managed Lake sink's OWN per-heartbeat write delta (events/bytes) — re-derived
 * from the cumulative Lake fraction `attachLakeSinkOutput` stamps on each data
 * point — so a pipeline fanning out to several sinks no longer over-counts the
 * Lake's storage volume. Data points without a Lake share contribute nothing.
 */
export async function updateLakeCatalogFromHeartbeat(
  input: LakeCatalogHeartbeatInput,
): Promise<void> {
  if (!isLakeEnabled()) return;
  const { orgId, environmentId, dataPoints, previousSnapshots } = input;
  if (dataPoints.length === 0) return;

  const now = new Date();
  const nowMs = now.getTime();
  const flushMs = Number(process.env.LAKE_CATALOG_FLUSH_MS ?? 60_000);

  // Accumulate the managed Lake sink's OWN write delta per pipeline (Lake-only,
  // re-derived from the cumulative Lake fraction) — not the whole pipeline
  // output — so the catalog reflects Lake storage volume, not fan-out egress.
  const perPipeline = new Map<string, { rows: bigint; bytes: bigint }>();
  for (const dp of dataPoints) {
    const prev = previousSnapshots?.get(`${dp.nodeId}:${dp.pipelineId}`);
    const lakeRows = splitLakeOutput(
      clamp(dp.eventsOut, prev?.eventsOut),
      dp.lakeEventsOut,
      dp.eventsOut,
    ).lake;
    const lakeBytes = splitLakeOutput(
      clamp(dp.bytesOut, prev?.bytesOut),
      dp.lakeBytesOut,
      dp.bytesOut,
    ).lake;
    const acc = perPipeline.get(dp.pipelineId) ?? { rows: BigInt(0), bytes: BigInt(0) };
    acc.rows += lakeRows;
    acc.bytes += lakeBytes;
    perPipeline.set(dp.pipelineId, acc);
  }

  // Fold this heartbeat's deltas into the debounce buffer rather than writing
  // now. Each (org, pipeline) flushes at most once per LAKE_CATALOG_FLUSH_MS
  // window, collapsing N heartbeats into one upsert + update and skipping the
  // config-resolving query on the heartbeats in between.
  for (const [pipelineId, totals] of perPipeline) {
    const key = `${orgId}:${pipelineId}`;
    const pending = pendingLakeWrites.get(key);
    if (pending) {
      pending.rows += totals.rows;
      pending.bytes += totals.bytes;
      pending.lastEventAt = now;
    } else {
      pendingLakeWrites.set(key, {
        environmentId,
        rows: totals.rows,
        bytes: totals.bytes,
        firstEventAt: now,
        lastEventAt: now,
        firstSeenAt: nowMs,
      });
    }
  }

  const duePipelineIds: string[] = [];
  for (const [key, pending] of pendingLakeWrites) {
    if (key.startsWith(`${orgId}:`) && nowMs - pending.firstSeenAt >= flushMs) {
      duePipelineIds.push(key.slice(orgId.length + 1));
    }
  }
  if (duePipelineIds.length === 0) return;

  // Resolve which DUE pipelines route to the lake from their latest deployed
  // config snapshot (the saved YAML still carries the LAKE[...] refs).
  const pipelines = await prisma.pipeline.findMany({
    where: { id: { in: duePipelineIds } },
    select: {
      id: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { configYaml: true },
      },
    },
  });
  const lakePipelineIds = new Set<string>();
  for (const pipeline of pipelines) {
    const configYaml = pipeline.versions[0]?.configYaml;
    if (configYaml && configYamlHasLakeSink(configYaml)) lakePipelineIds.add(pipeline.id);
  }

  for (const pipelineId of duePipelineIds) {
    const key = `${orgId}:${pipelineId}`;
    const pending = pendingLakeWrites.get(key);
    // Drop the buffered entry regardless of routing so a non-lake pipeline
    // does not re-resolve its config every window.
    pendingLakeWrites.delete(key);
    if (!pending || !lakePipelineIds.has(pipelineId)) continue;
    try {
      await upsertLakeDataset({ orgId, pipelineId, environmentId: pending.environmentId });
      if (pending.rows > BigInt(0) || pending.bytes > BigInt(0)) {
        await recordLakeIngest({
          orgId,
          pipelineId,
          rowsAdded: pending.rows,
          bytesAdded: pending.bytes,
          firstEventAt: pending.firstEventAt,
          lastEventAt: pending.lastEventAt,
        });
      }
    } catch (err) {
      errorLog("lake-catalog", `Failed to update lake catalog for pipeline ${pipelineId}`, err);
    }
  }
}

function configYamlHasLakeSink(configYaml: string): boolean {
  try {
    const parsed = yaml.load(configYaml);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return configHasLakeSink(parsed as Record<string, unknown>);
  } catch {
    return false;
  }
}
