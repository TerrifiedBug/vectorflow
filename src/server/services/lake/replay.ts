import { createHash } from "node:crypto";
import { Prisma, type ReplayJob } from "@/generated/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import { isLakeEnabled, lakeQuery } from "./clickhouse";
import {
  LAKE_MAX_LIMIT,
  LAKE_MAX_EXECUTION_TIME_SECONDS,
  LAKE_MAX_RESULT_ROWS,
  LAKE_MAX_ROWS_TO_READ,
  type LakeEvent,
  type LakeEventType,
} from "./lake-query";

/**
 * VectorFlow Lake — replay / rehydration service (A4).
 *
 * A replay job re-reads stored events from the lake over a time window and
 * re-injects them into a target pipeline. There is no ClickHouse *source* in
 * Vector, so re-injection is **pull-based**: the agent running the target
 * pipeline polls `/api/agent/replay`, which calls `nextReplayBatch` to hand
 * back a bounded, cursor-advanced window of lake events. A dedicated Vector
 * replay-source (an `http_client` source decoding NDJSON) is the agent-side
 * integration point — no Go agent changes live here.
 *
 * Cursor model: the `ReplayJob` row has no dedicated cursor column; the
 * monotonic `replayedEvents` counter *is* the cursor. Each pull selects the
 * window `OFFSET replayedEvents LIMIT batchSize` over an immutable past time
 * range, so OFFSET pagination is deterministic as long as the ORDER BY fully
 * orders the rows (timestamp + tie-breakers below). Every returned event is
 * stamped with the job's `dedupeKey` so a downstream sink can dedupe a re-run
 * and the replayed copies stay distinguishable from live traffic.
 *
 * Every database access is org-scoped through `withOrgTx`; every lake read
 * binds `organizationId` as a query parameter (never interpolated) and guards
 * on `isLakeEnabled()` so the service is inert on non-lake deployments.
 */

/** ClickHouse events table — unqualified so it resolves against the lake
 *  connection's default database (mirrors lake-query.ts). */
const LAKE_EVENTS_TABLE = "lake_events";

/** Full `lake_events` column set, re-injected verbatim so a replayed event is
 *  byte-faithful to the stored original (mirrors lake-query's EVENT_COLUMNS). */
const REPLAY_EVENT_COLUMNS =
  "organizationId, pipelineId, eventType, timestamp, traceId, spanId, host, source, severity, message, raw, attrs";

/** Default replay batch size when the caller does not specify one. */
export const REPLAY_DEFAULT_BATCH_SIZE = 1_000;

/** Replay job lifecycle states (mirrors the `ReplayJob.status` string union). */
export const REPLAY_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type ReplayStatus = (typeof REPLAY_STATUS)[keyof typeof REPLAY_STATUS];

/** States from which a job can still serve batches / be cancelled. */
const ACTIVE_STATUSES: ReplayStatus[] = [REPLAY_STATUS.PENDING, REPLAY_STATUS.RUNNING];

/** Optional lake read filter applied to a replay (mirrors searchEvents). */
export interface ReplayFilter {
  eventType?: LakeEventType;
  query?: string;
}

const REPLAY_EVENT_TYPES: readonly LakeEventType[] = ["log", "metric", "trace"];

/** Stable error codes so the router can map failures to the right TRPCError. */
export type ReplayErrorCode =
  | "LAKE_DISABLED"
  | "SOURCE_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "NOT_FOUND"
  | "NOT_CANCELLABLE";

export class ReplayError extends Error {
  constructor(
    message: string,
    readonly code: ReplayErrorCode,
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

/** A dedupe-stamped event handed to the agent for re-injection. */
export type ReplayEvent = LakeEvent & {
  /** The job whose cursor produced this event. */
  replayJobId: string;
  /** Idempotency marker — identical across re-runs of the same replay. */
  replayDedupeKey: string;
};

/** Result of a single agent pull. `null` is returned (separately) when no
 *  active job exists for the target pipeline. */
export interface ReplayBatch {
  jobId: string;
  dedupeKey: string;
  status: ReplayStatus;
  /** Cursor after this batch (BigInt — total events served so far). */
  replayedEvents: bigint;
  totalEvents: bigint;
  /** True once the window is drained and the job flipped to COMPLETED. */
  done: boolean;
  events: ReplayEvent[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Per-query ClickHouse guardrails (statement timeout, result/scan caps),
 *  embedded in SQL because the A1 wrapper only exposes `(sql, params)`. */
const REPLAY_QUERY_SETTINGS =
  `SETTINGS max_execution_time = ${LAKE_MAX_EXECUTION_TIME_SECONDS}, ` +
  `max_result_rows = ${LAKE_MAX_RESULT_ROWS}, result_overflow_mode = 'break', ` +
  `max_rows_to_read = ${LAKE_MAX_ROWS_TO_READ}, read_overflow_mode = 'throw'`;

/** Clamp a caller-supplied batch size into `[1, LAKE_MAX_LIMIT]`. */
export function clampBatchSize(batchSize: number | undefined): number {
  if (typeof batchSize !== "number" || !Number.isFinite(batchSize) || batchSize <= 0) {
    return REPLAY_DEFAULT_BATCH_SIZE;
  }
  return Math.min(Math.floor(batchSize), LAKE_MAX_LIMIT);
}

/** ClickHouse `count()` renders UInt64 as a string in JSONEachRow; parse it
 *  back to BigInt without going through a lossy Number. */
function toBigInt(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return BigInt(0);
  if (typeof value === "bigint") return value;
  const text = String(value).trim();
  if (text === "" || !/^-?\d+$/.test(text)) return BigInt(0);
  return BigInt(text);
}

/** Coerce a stored `filter` JSON value into a typed, safe `ReplayFilter`.
 *  Unknown / malformed shapes degrade to an empty filter rather than throw. */
export function parseFilter(value: unknown): ReplayFilter {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const out: ReplayFilter = {};
  if (
    typeof record.eventType === "string" &&
    REPLAY_EVENT_TYPES.includes(record.eventType as LakeEventType)
  ) {
    out.eventType = record.eventType as LakeEventType;
  }
  if (typeof record.query === "string" && record.query.trim()) {
    out.query = record.query.trim();
  }
  return out;
}

/** Deterministic dedupe key: identical replay requests (same org, pipelines,
 *  window, filter) produce the same key so a downstream sink can drop the
 *  duplicate re-injection. */
function computeDedupeKey(args: {
  orgId: string;
  sourcePipelineId: string;
  targetPipelineId: string;
  fromTime: Date;
  toTime: Date;
  filter: ReplayFilter;
}): string {
  const canonical = JSON.stringify({
    orgId: args.orgId,
    source: args.sourcePipelineId,
    target: args.targetPipelineId,
    from: args.fromTime.toISOString(),
    to: args.toTime.toISOString(),
    filter: { eventType: args.filter.eventType ?? null, query: args.filter.query ?? null },
  });
  return "rpl_" + createHash("sha256").update(canonical).digest("hex").slice(0, 40);
}

/** Build the shared org+pipeline+window(+filter) predicate for both the count
 *  and the windowed read. Org scope and the free-text term are bound params —
 *  they can never alter the query shape. */
function buildReplayConditions(args: {
  orgId: string;
  pipelineId: string;
  from: Date;
  to: Date;
  filter: ReplayFilter;
}): { where: string; params: Record<string, unknown> } {
  const conditions = [
    "organizationId = {orgId:String}",
    "pipelineId = {pipelineId:String}",
    "timestamp >= {from:DateTime64(3)}",
    "timestamp <= {to:DateTime64(3)}",
  ];
  const params: Record<string, unknown> = {
    orgId: args.orgId,
    pipelineId: args.pipelineId,
    from: args.from,
    to: args.to,
  };
  if (args.filter.eventType) {
    conditions.push("eventType = {eventType:String}");
    params.eventType = args.filter.eventType;
  }
  if (args.filter.query) {
    conditions.push(
      "(positionCaseInsensitive(message, {query:String}) > 0 OR positionCaseInsensitive(raw, {query:String}) > 0)",
    );
    params.query = args.filter.query;
  }
  return { where: conditions.join(" AND "), params };
}

/** Count the lake events a replay would re-inject — the `totalEvents` estimate
 *  stamped on the job at creation. Returns 0 when the lake is disabled. */
export async function countLakeEvents(args: {
  orgId: string;
  pipelineId: string;
  from: Date;
  to: Date;
  filter?: ReplayFilter;
}): Promise<bigint> {
  if (!isLakeEnabled()) return BigInt(0);
  const { where, params } = buildReplayConditions({ ...args, filter: args.filter ?? {} });
  const sql = `SELECT count() AS c FROM ${LAKE_EVENTS_TABLE} WHERE ${where} ${REPLAY_QUERY_SETTINGS}`;
  const rows = await lakeQuery<{ c: string | number }>(sql, params);
  return rows.length > 0 ? toBigInt(rows[0].c) : BigInt(0);
}

/** Read the next bounded, chronologically-ordered window after the cursor.
 *  ORDER BY fully orders rows (timestamp + tie-breakers) so OFFSET pagination
 *  over the immutable past window is deterministic across pulls. */
async function fetchReplayWindow(args: {
  orgId: string;
  pipelineId: string;
  from: Date;
  to: Date;
  filter: ReplayFilter;
  limit: number;
  offset: bigint;
}): Promise<LakeEvent[]> {
  if (!isLakeEnabled()) return [];
  const { where, params } = buildReplayConditions(args);
  params.limit = args.limit;
  // Bind OFFSET as a string so a multi-billion-row cursor never loses
  // precision through a JS number.
  params.offset = args.offset.toString();
  const sql =
    `SELECT ${REPLAY_EVENT_COLUMNS} FROM ${LAKE_EVENTS_TABLE} ` +
    `WHERE ${where} ` +
    `ORDER BY timestamp ASC, traceId ASC, spanId ASC, raw ASC ` +
    `LIMIT {limit:UInt32} OFFSET {offset:UInt64} ` +
    REPLAY_QUERY_SETTINGS;
  return lakeQuery<LakeEvent>(sql, params);
}

// ── public service API ───────────────────────────────────────────────────────

/**
 * Create a PENDING replay job: validate both pipelines belong to the org,
 * estimate `totalEvents` via a lake count, compute a deterministic dedupe key,
 * and persist the row. Throws `ReplayError("LAKE_DISABLED")` when the lake is
 * not configured.
 */
export async function createReplayJob(args: {
  orgId: string;
  sourcePipelineId: string;
  targetPipelineId: string;
  fromTime: Date;
  toTime: Date;
  filter?: ReplayFilter | null;
  userId?: string | null;
}): Promise<ReplayJob> {
  if (!isLakeEnabled()) {
    throw new ReplayError("VectorFlow Lake is not configured", "LAKE_DISABLED");
  }

  const filter = args.filter ?? {};
  const totalEvents = await countLakeEvents({
    orgId: args.orgId,
    pipelineId: args.sourcePipelineId,
    from: args.fromTime,
    to: args.toTime,
    filter,
  });
  const dedupeKey = computeDedupeKey({
    orgId: args.orgId,
    sourcePipelineId: args.sourcePipelineId,
    targetPipelineId: args.targetPipelineId,
    fromTime: args.fromTime,
    toTime: args.toTime,
    filter,
  });

  return withOrgTx(args.orgId, async (tx) => {
    // Both pipelines must live in this org. RLS already fences the tx, but the
    // explicit organizationId predicate keeps the check correct even if RLS is
    // ever relaxed and makes a cross-org id surface as NOT_FOUND, not a leak.
    const [source, target] = await Promise.all([
      tx.pipeline.findFirst({
        where: { id: args.sourcePipelineId, organizationId: args.orgId },
        select: { id: true },
      }),
      tx.pipeline.findFirst({
        where: { id: args.targetPipelineId, organizationId: args.orgId },
        select: { id: true },
      }),
    ]);
    if (!source) throw new ReplayError("Source pipeline not found", "SOURCE_NOT_FOUND");
    if (!target) throw new ReplayError("Target pipeline not found", "TARGET_NOT_FOUND");

    return tx.replayJob.create({
      data: {
        organizationId: args.orgId,
        sourcePipelineId: args.sourcePipelineId,
        targetPipelineId: args.targetPipelineId,
        fromTime: args.fromTime,
        toTime: args.toTime,
        filter:
          args.filter && (args.filter.eventType || args.filter.query)
            ? (args.filter as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        status: REPLAY_STATUS.PENDING,
        totalEvents,
        replayedEvents: BigInt(0),
        dedupeKey,
        createdById: args.userId ?? null,
      },
    });
  });
}

/**
 * Agent-pull primitive. Find the org's oldest active (PENDING|RUNNING) job for
 * `targetPipelineId`, serve the next bounded window, advance the cursor, and
 * flip status: PENDING→RUNNING on the first pull, →COMPLETED once drained.
 * Returns `null` when no active job exists (the route answers 204).
 *
 * The cursor read+advance happen in one org transaction, and the advancing
 * update is guarded on the job still being active — so a cancel landing
 * between the find and the update wins (the batch is discarded, the counter
 * never moves), keeping a mid-run cancel consistent.
 */
export async function nextReplayBatch(args: {
  orgId: string;
  targetPipelineId: string;
  batchSize?: number;
}): Promise<ReplayBatch | null> {
  if (!isLakeEnabled()) return null;
  const batchSize = clampBatchSize(args.batchSize);

  return withOrgTx(args.orgId, async (tx) => {
    const job = await tx.replayJob.findFirst({
      where: {
        organizationId: args.orgId,
        targetPipelineId: args.targetPipelineId,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: { createdAt: "asc" },
    });
    if (!job) return null;

    const events = await fetchReplayWindow({
      orgId: args.orgId,
      pipelineId: job.sourcePipelineId,
      from: job.fromTime,
      to: job.toTime,
      filter: parseFilter(job.filter),
      limit: batchSize,
      offset: job.replayedEvents,
    });

    const fetched = events.length;
    const replayedEvents = job.replayedEvents + BigInt(fetched);
    // A short read is the authoritative drain signal: the window holds fewer
    // rows than requested, so there is nothing left. We deliberately do NOT
    // complete early on `replayedEvents >= totalEvents` — totalEvents is an
    // estimate from create time, and trusting it would silently drop events if
    // the window were still receiving writes. The cost is one final empty pull.
    const done = fetched < batchSize;
    const status: ReplayStatus = done ? REPLAY_STATUS.COMPLETED : REPLAY_STATUS.RUNNING;
    const now = new Date();

    const data: Prisma.ReplayJobUpdateManyMutationInput = { status, replayedEvents };
    if (!job.startedAt) data.startedAt = now;
    if (done) data.completedAt = now;

    // Guard on the job still being active: if it was cancelled/completed
    // concurrently, do not resurrect it or hand out the batch.
    const updated = await tx.replayJob.updateMany({
      where: { id: job.id, status: { in: ACTIVE_STATUSES } },
      data,
    });
    if (updated.count === 0) return null;

    const stamped: ReplayEvent[] = events.map((event) => ({
      ...event,
      replayJobId: job.id,
      replayDedupeKey: job.dedupeKey,
    }));

    return {
      jobId: job.id,
      dedupeKey: job.dedupeKey,
      status,
      replayedEvents,
      totalEvents: job.totalEvents,
      done,
      events: stamped,
    };
  });
}

/**
 * Cancel an active job → CANCELLED, stamping `completedAt` and leaving the
 * `replayedEvents`/`totalEvents` counters untouched (consistent partial
 * progress). Idempotent on an already-cancelled job; refuses to cancel a job
 * that already reached a terminal COMPLETED/FAILED state.
 */
export async function cancelReplayJob(args: {
  orgId: string;
  jobId: string;
}): Promise<ReplayJob> {
  return withOrgTx(args.orgId, async (tx) => {
    const job = await tx.replayJob.findFirst({
      where: { id: args.jobId, organizationId: args.orgId },
    });
    if (!job) throw new ReplayError("Replay job not found", "NOT_FOUND");
    if (job.status === REPLAY_STATUS.CANCELLED) return job; // idempotent
    if (job.status !== REPLAY_STATUS.PENDING && job.status !== REPLAY_STATUS.RUNNING) {
      throw new ReplayError(`Cannot cancel a ${job.status.toLowerCase()} replay job`, "NOT_CANCELLABLE");
    }
    return tx.replayJob.update({
      where: { id: job.id },
      data: { status: REPLAY_STATUS.CANCELLED, completedAt: new Date() },
    });
  });
}

/** Fetch a single replay job, org-scoped. Returns `null` when absent. */
export async function getReplayJob(args: {
  orgId: string;
  jobId: string;
}): Promise<ReplayJob | null> {
  return withOrgTx(args.orgId, async (tx) =>
    tx.replayJob.findFirst({
      where: { id: args.jobId, organizationId: args.orgId },
    }),
  );
}

/** List replay jobs that touch a pipeline (as source or target), newest
 *  first, org-scoped. */
export async function listReplayJobs(args: {
  orgId: string;
  pipelineId: string;
}): Promise<ReplayJob[]> {
  return withOrgTx(args.orgId, async (tx) =>
    tx.replayJob.findMany({
      where: {
        organizationId: args.orgId,
        OR: [{ sourcePipelineId: args.pipelineId }, { targetPipelineId: args.pipelineId }],
      },
      orderBy: { createdAt: "desc" },
    }),
  );
}
