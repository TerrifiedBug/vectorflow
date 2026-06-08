import { adminPrisma } from "@/lib/prisma";
import { debugLog, infoLog, errorLog } from "@/lib/logger";
import { isLeader } from "@/server/services/leader-election";
import type { LakeRetentionPolicy } from "@/generated/prisma";
import { getLakeClient, isLakeEnabled } from "@/server/services/lake/clickhouse";

/**
 * VectorFlow Lake — retention enforcement (CL-9).
 *
 * `LakeRetentionPolicy(hotDays, coldDays)` was attached to datasets but never
 * enforced beyond the table-level default TTL baked into the base DDL. This
 * module turns the policy into the dataset's *effective* retention window and
 * enforces it two ways:
 *
 *   1. `effectiveRetention` + `buildLakeTtlClause` compute the TTL clause from a
 *      policy (falling back to the table defaults). The migration runner uses
 *      these for the base `lake_events` TTL, so the table default now flows
 *      through the SAME code path a per-dataset window would.
 *   2. `enforceDatasetRetention` applies a dataset's `coldDays` as a hard DROP
 *      horizon in ClickHouse — a bounded, org+pipeline-scoped DELETE of events
 *      older than `now - coldDays`. This catches datasets whose policy is SHORTER
 *      than the table TTL (which would otherwise keep their rows until the global
 *      90-day delete). `sweepLakeRetention` runs it across every catalog dataset
 *      on a coarse leader-gated cadence.
 *
 * Retention deletion is the intended lifecycle of stored data (unlike the Lake
 * BYTE quota in `lake-quota.ts`, which is a soft signal and never drops). All
 * ClickHouse access goes through the shared lake client so it is mockable.
 */

/** ClickHouse events table — unqualified so it resolves against the lake
 *  connection's default database (VF_LAKE_CLICKHOUSE_DATABASE). */
const LAKE_EVENTS_TABLE = "lake_events";

/** Table-default retention windows. Mirror the `LakeRetentionPolicy` schema
 *  defaults; used when a dataset has no attached policy. */
export const LAKE_DEFAULT_HOT_DAYS = 7;
export const LAKE_DEFAULT_COLD_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Coarse sweep cadence — retention is a slow lifecycle, so daily is plenty and
 *  keeps ClickHouse mutation churn low. */
const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface EffectiveRetention {
  /** Days kept in the hot MergeTree tier before TTL-move to the cold disk. */
  hotDays: number;
  /** Total retention before TTL-delete (the drop horizon). Always >= hotDays. */
  coldDays: number;
}

/** A retention policy is only the two windows we act on (accepts the full model). */
export type RetentionPolicyWindows = Pick<LakeRetentionPolicy, "hotDays" | "coldDays">;

/**
 * Compute the effective retention window for a dataset. Falls back to the table
 * defaults (7/90) when the dataset has no attached policy. Defends against a
 * malformed policy: non-positive windows fall back, and `coldDays` is clamped up
 * to `hotDays` so the drop horizon can never precede the hot→cold move.
 */
export function effectiveRetention(
  policy?: RetentionPolicyWindows | null,
): EffectiveRetention {
  const hotDays = policy && policy.hotDays > 0 ? policy.hotDays : LAKE_DEFAULT_HOT_DAYS;
  const coldDaysRaw =
    policy && policy.coldDays > 0 ? policy.coldDays : LAKE_DEFAULT_COLD_DAYS;
  const coldDays = Math.max(coldDaysRaw, hotDays);
  return { hotDays, coldDays };
}

/**
 * Build the ClickHouse `TTL` clause for `lake_events` from an effective window.
 * Cold-tier enabled → move-to-cold at `hotDays` + DELETE at `coldDays` + the
 * hot/cold storage policy; cold-tier disabled → DELETE at `coldDays` only (plain
 * MergeTree). Shared by the base migration and any per-dataset tiering path so a
 * single function owns the TTL shape.
 */
export function buildLakeTtlClause(
  retention: EffectiveRetention,
  coldTierEnabled: boolean,
): string {
  return coldTierEnabled
    ? `TTL toDateTime(timestamp) + INTERVAL ${retention.hotDays} DAY TO VOLUME 'cold', ` +
        `toDateTime(timestamp) + INTERVAL ${retention.coldDays} DAY DELETE\n` +
        `SETTINGS storage_policy = 'vf_hot_cold'`
    : `TTL toDateTime(timestamp) + INTERVAL ${retention.coldDays} DAY DELETE`;
}

export interface LakeRetentionSweepItem {
  pipelineId: string;
  coldDays: number;
  /** ISO cutoff: events strictly older than this were targeted for deletion. */
  cutoff: string;
}

export interface DatasetRetentionTarget {
  orgId: string;
  pipelineId: string;
  policy?: RetentionPolicyWindows | null;
  /** Override "now" (tests). Defaults to the wall clock. */
  now?: Date;
}

/**
 * Enforce a single dataset's effective `coldDays` as a DROP horizon: issue a
 * bounded, org+pipeline-scoped ClickHouse DELETE for events older than
 * `now - coldDays`. Returns the computed window + cutoff for logging. No-op
 * (returns `null`) when the lake is disabled. The org/pipeline scope and cutoff
 * are bound parameters, never interpolated.
 */
export async function enforceDatasetRetention(
  target: DatasetRetentionTarget,
): Promise<LakeRetentionSweepItem | null> {
  if (!isLakeEnabled()) return null;

  const { coldDays } = effectiveRetention(target.policy);
  const now = target.now ?? new Date();
  const cutoff = new Date(now.getTime() - coldDays * MS_PER_DAY);

  await getLakeClient().command({
    query:
      `DELETE FROM ${LAKE_EVENTS_TABLE} ` +
      `WHERE organizationId = {orgId:String} ` +
      `AND pipelineId = {pipelineId:String} ` +
      `AND timestamp < {cutoff:DateTime64(3)}`,
    query_params: {
      orgId: target.orgId,
      pipelineId: target.pipelineId,
      cutoff,
    },
  });

  return { pipelineId: target.pipelineId, coldDays, cutoff: cutoff.toISOString() };
}

export interface LakeRetentionSweepResult {
  /** True when the lake is disabled and nothing was swept. */
  skipped: boolean;
  /** Number of datasets whose drop horizon was enforced. */
  swept: number;
  /** Number of datasets that errored (logged + skipped, sweep continues). */
  errors: number;
}

/**
 * Enforce retention across every catalog dataset, applying each dataset's
 * effective `coldDays` drop horizon. Cross-tenant read via `adminPrisma` (the
 * ClickHouse DELETE is org+pipeline scoped by bound params); a per-dataset error
 * is logged and skipped so one bad dataset never stalls the sweep. No-op when the
 * lake is disabled.
 */
export async function sweepLakeRetention(
  now: Date = new Date(),
): Promise<LakeRetentionSweepResult> {
  const result: LakeRetentionSweepResult = { skipped: true, swept: 0, errors: 0 };
  if (!isLakeEnabled()) return result;
  result.skipped = false;

  let datasets: Array<{
    organizationId: string;
    pipelineId: string;
    retentionPolicy: RetentionPolicyWindows | null;
  }>;
  try {
    datasets = await adminPrisma.lakeDataset.findMany({
      select: {
        organizationId: true,
        pipelineId: true,
        retentionPolicy: { select: { hotDays: true, coldDays: true } },
      },
    });
  } catch (err) {
    errorLog("lake-retention", "Failed to list lake datasets (skipping sweep)", err);
    return result;
  }

  for (const ds of datasets) {
    try {
      await enforceDatasetRetention({
        orgId: ds.organizationId,
        pipelineId: ds.pipelineId,
        policy: ds.retentionPolicy,
        now,
      });
      result.swept += 1;
    } catch (err) {
      result.errors += 1;
      errorLog(
        "lake-retention",
        `Retention sweep failed for org ${ds.organizationId} pipeline ${ds.pipelineId} (continuing)`,
        err,
      );
    }
  }
  return result;
}

// ── Scheduler ────────────────────────────────────────────────────────────────
let timer: NodeJS.Timeout | null = null;
let tickInFlight = false;

async function tick(): Promise<void> {
  // Re-check leadership each tick (mirrors lake-alerts): a demoted leader's
  // setInterval keeps firing for up to one lease TTL; guarding here stops the
  // old + new leader both sweeping (the DELETEs are idempotent, but this avoids
  // doubling ClickHouse mutation load).
  if (!isLeader()) {
    debugLog("lake-retention", "Skipping sweep — instance is no longer leader");
    return;
  }
  if (tickInFlight) return; // setInterval does not skip overlapping callbacks
  tickInFlight = true;
  try {
    const r = await sweepLakeRetention();
    if (!r.skipped && (r.swept > 0 || r.errors > 0)) {
      infoLog("lake-retention", `sweep: enforced=${r.swept} errors=${r.errors}`);
    }
  } catch (err) {
    errorLog("lake-retention", "sweep failed", err);
  } finally {
    tickInFlight = false;
  }
}

/**
 * Start the leader-gated lake retention sweeper. No-op when the lake is disabled,
 * so enabling the lake is env-only (matches `runLakeMigrations` /
 * `initLakeAlertScheduler`). Idempotent.
 */
export function initLakeRetentionScheduler(): void {
  if (!isLakeEnabled()) {
    infoLog("lake-retention", "Lake disabled — retention sweeper not started");
    return;
  }
  if (timer) return;
  timer = setInterval(() => void tick(), RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();
  infoLog(
    "lake-retention",
    `Retention sweeper started (every ${RETENTION_SWEEP_INTERVAL_MS / (60 * 60 * 1000)}h)`,
  );
}

export function stopLakeRetentionScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
