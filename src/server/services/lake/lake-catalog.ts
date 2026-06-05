import yaml from "js-yaml";
import { prisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import { errorLog } from "@/lib/logger";
import { configHasLakeSink } from "@/lib/vector/lake-sink";
import { isLakeEnabled } from "./clickhouse";
import {
  computeDeltas,
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

/**
 * Heartbeat hook: refresh the lake catalog for every reporting pipeline that
 * routes to the managed lake sink. No-op unless the lake is enabled. Uses the
 * pipeline's per-heartbeat OUTPUT delta (events/bytes since the previous
 * snapshot) as the lake-write estimate — exact per-sink accounting isn't
 * available at the metrics layer, so a pipeline fanning out to several sinks
 * over-counts; the catalog is an estimate, not a billing source.
 */
export async function updateLakeCatalogFromHeartbeat(
  input: LakeCatalogHeartbeatInput,
): Promise<void> {
  if (!isLakeEnabled()) return;
  const { orgId, environmentId, dataPoints, previousSnapshots } = input;
  if (dataPoints.length === 0) return;

  const now = new Date();
  const deltas = computeDeltas(dataPoints, previousSnapshots, now, orgId);

  const perPipeline = new Map<string, { rows: bigint; bytes: bigint }>();
  for (const delta of deltas) {
    const acc = perPipeline.get(delta.pipelineId) ?? { rows: BigInt(0), bytes: BigInt(0) };
    acc.rows += delta.eventsOut;
    acc.bytes += delta.bytesOut;
    perPipeline.set(delta.pipelineId, acc);
  }

  const pipelineIds = [...perPipeline.keys()];
  if (pipelineIds.length === 0) return;

  // Resolve which of these pipelines route to the lake from their latest
  // deployed config snapshot (the saved YAML still carries the LAKE[...] refs).
  const pipelines = await prisma.pipeline.findMany({
    where: { id: { in: pipelineIds } },
    select: {
      id: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { configYaml: true },
      },
    },
  });

  for (const pipeline of pipelines) {
    const configYaml = pipeline.versions[0]?.configYaml;
    if (!configYaml || !configYamlHasLakeSink(configYaml)) continue;
    const totals = perPipeline.get(pipeline.id);
    if (!totals) continue;
    try {
      await upsertLakeDataset({ orgId, pipelineId: pipeline.id, environmentId });
      if (totals.rows > BigInt(0) || totals.bytes > BigInt(0)) {
        await recordLakeIngest({
          orgId,
          pipelineId: pipeline.id,
          rowsAdded: totals.rows,
          bytesAdded: totals.bytes,
          firstEventAt: now,
          lastEventAt: now,
        });
      }
    } catch (err) {
      errorLog("lake-catalog", `Failed to update lake catalog for pipeline ${pipeline.id}`, err);
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
