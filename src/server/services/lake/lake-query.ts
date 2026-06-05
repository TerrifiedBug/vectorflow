import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { isLakeEnabled, lakeQuery } from "./clickhouse";

/**
 * VectorFlow Lake — search-in-place query engine (A3).
 *
 * Every event-reading function here is **always** organization-scoped: the
 * caller's `orgId` is injected as a ClickHouse *bound parameter*
 * (`{orgId:String}`), never string-concatenated into the SQL. A query built for
 * org A can therefore never read org B's `lake_events` rows — the only way to
 * change the org predicate is to change the bound value, which the tRPC layer
 * sources from `ctx.organizationId` (never from caller input).
 *
 * Hard guardrails on every ClickHouse read:
 *   - row LIMIT clamped to `LAKE_MAX_LIMIT`,
 *   - a maximum time window (`LAKE_MAX_RANGE_MS`) clamped server-side,
 *   - per-query ClickHouse SETTINGS: `max_execution_time` (statement timeout),
 *     `max_result_rows` (+ `result_overflow_mode='break'`) and
 *     `max_rows_to_read` (scan cap, `read_overflow_mode='throw'`).
 *
 * The whole module degrades to a no-op when the lake is unconfigured: each
 * function returns an empty result when `isLakeEnabled()` is false, so non-lake
 * deployments are unaffected.
 */

/** ClickHouse events table — unqualified so it resolves against the lake
 *  connection's default database (VF_LAKE_CLICKHOUSE_DATABASE). */
const LAKE_EVENTS_TABLE = "lake_events";

export type LakeEventType = "log" | "metric" | "trace";
export const LAKE_EVENT_TYPES: readonly LakeEventType[] = ["log", "metric", "trace"];

// ── Guardrails ───────────────────────────────────────────────────────────────
/** Hard cap on rows returned by a single search. */
export const LAKE_MAX_LIMIT = 10_000;
/** Default search page size when the caller does not specify one. */
export const LAKE_DEFAULT_LIMIT = 100;
/** Statement timeout (seconds) applied to every lake read. */
export const LAKE_MAX_EXECUTION_TIME_SECONDS = 30;
/** Result-row backstop; mirrors the LIMIT cap. `result_overflow_mode='break'`
 *  truncates instead of erroring. */
export const LAKE_MAX_RESULT_ROWS = LAKE_MAX_LIMIT;
/** Scan cap — abort (throw) a query that would read more than this many rows
 *  from storage, protecting ClickHouse from runaway full-table scans. */
export const LAKE_MAX_ROWS_TO_READ = 1_000_000_000;
/** Maximum time window a single query may span (31 days). */
export const LAKE_MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

const SCHEMA_SAMPLE_ROWS = 10_000;
const SCHEMA_FIELD_LIMIT = 500;
const FIELD_STATS_DEFAULT_LIMIT = 50;
const FIELD_STATS_MAX_LIMIT = 1_000;

/**
 * Per-query ClickHouse guardrail settings, embedded in the SQL `SETTINGS`
 * clause. Embedded (rather than passed via the driver) because the A1 wrapper's
 * `lakeQuery` intentionally exposes only `(sql, params)`; the SETTINGS clause is
 * standard ClickHouse SQL and keeps the guardrails self-contained here.
 */
function lakeSettingsClause(): string {
  // Single template literal (NOT `+`-concatenated parts). The bundler corrupted
  // the multi-part form while inlining the constants — it dropped the separators
  // and emitted invalid SQL (`...= 30max_result_rows = 10000...`), breaking every
  // lake search. One literal inlines to a plain, valid string.
  return `SETTINGS max_execution_time = ${LAKE_MAX_EXECUTION_TIME_SECONDS}, max_result_rows = ${LAKE_MAX_RESULT_ROWS}, result_overflow_mode = 'break', max_rows_to_read = ${LAKE_MAX_ROWS_TO_READ}, read_overflow_mode = 'throw'`;
}

/** Clamp a caller-supplied limit into `(0, max]`, falling back when absent/bad. */
function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(limit), max);
}

/**
 * Defense-in-depth time-window clamp: even if the router's range validation is
 * bypassed, never let a single query scan more than `LAKE_MAX_RANGE_MS`. Pulls
 * `from` forward to `to - LAKE_MAX_RANGE_MS` when the window is too wide.
 */
function clampFrom(from: Date, to: Date): Date {
  if (to.getTime() - from.getTime() > LAKE_MAX_RANGE_MS) {
    return new Date(to.getTime() - LAKE_MAX_RANGE_MS);
  }
  return from;
}

/** A single row from `lake_events`. `timestamp` is the ClickHouse-formatted
 *  string (JSONEachRow renders DateTime64 as text). */
export interface LakeEvent {
  organizationId: string;
  pipelineId: string;
  eventType: LakeEventType;
  timestamp: string;
  traceId: string;
  spanId: string;
  host: string;
  source: string;
  severity: string;
  message: string;
  raw: string;
  attrs: Record<string, string>;
}

const EVENT_COLUMNS =
  "organizationId, pipelineId, eventType, timestamp, traceId, spanId, host, source, severity, message, raw, attrs";

export interface SearchEventsArgs {
  orgId: string;
  pipelineId: string;
  from: Date;
  to: Date;
  eventType?: LakeEventType;
  /** Free-text term matched (case-insensitive) against `message` and `raw`. */
  query?: string;
  limit?: number;
}

/**
 * Guided/structured search: org + pipeline + time window, with optional event
 * type and free-text filters. Org scope and the free-text term are bound
 * parameters — the free-text term can never alter the query shape.
 */
export async function searchEvents(args: SearchEventsArgs): Promise<LakeEvent[]> {
  if (!isLakeEnabled()) return [];

  const to = args.to;
  const from = clampFrom(args.from, to);
  const limit = clampLimit(args.limit, LAKE_DEFAULT_LIMIT, LAKE_MAX_LIMIT);

  const conditions = [
    "organizationId = {orgId:String}",
    "pipelineId = {pipelineId:String}",
    "timestamp >= {from:DateTime64(3)}",
    "timestamp <= {to:DateTime64(3)}",
  ];
  const params: Record<string, unknown> = {
    orgId: args.orgId,
    pipelineId: args.pipelineId,
    from,
    to,
    limit,
  };

  if (args.eventType) {
    conditions.push("eventType = {eventType:String}");
    params.eventType = args.eventType;
  }

  const term = args.query?.trim();
  if (term) {
    conditions.push(
      "(positionCaseInsensitive(message, {query:String}) > 0 OR positionCaseInsensitive(raw, {query:String}) > 0)",
    );
    params.query = term;
  }

  const sql =
    `SELECT ${EVENT_COLUMNS} FROM ${LAKE_EVENTS_TABLE} ` +
    `WHERE ${conditions.join(" AND ")} ` +
    `ORDER BY timestamp DESC LIMIT {limit:UInt32} ` +
    lakeSettingsClause();

  return lakeQuery<LakeEvent>(sql, params);
}

/** Thrown when an ADMIN raw filter expression fails the safety check. */
export class LakeRawWhereError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LakeRawWhereError";
  }
}

const MAX_RAW_WHERE_LENGTH = 2000;
/** Subquery guard — a parenthesised SELECT is the only way to smuggle a
 *  cross-org boolean oracle past the mandatory top-level org predicate. */
const RAW_WHERE_SUBQUERY = /\(\s*select\b/i;
/** Statement separators and comment tokens are never valid inside a filter. */
const RAW_WHERE_FORBIDDEN = /(;|--|\/\*|\*\/)/;

/**
 * Validate an ADMIN-supplied raw WHERE expression. Returns the trimmed
 * expression or throws `LakeRawWhereError`. Note: even a fully permitted
 * expression cannot widen org scope — `rawSearchEvents` always ANDs the
 * mandatory `organizationId = {orgId:String}` predicate at the top level, so
 * the worst a filter can do is narrow results. Subqueries and statement/comment
 * tokens are rejected to close the boolean-oracle side channel.
 */
export function assertSafeRawWhere(where: string): string {
  const trimmed = where.trim();
  if (trimmed.length === 0) {
    throw new LakeRawWhereError("Filter expression is empty");
  }
  if (trimmed.length > MAX_RAW_WHERE_LENGTH) {
    throw new LakeRawWhereError("Filter expression is too long");
  }
  if (RAW_WHERE_FORBIDDEN.test(trimmed) || RAW_WHERE_SUBQUERY.test(trimmed)) {
    throw new LakeRawWhereError(
      "Filter expression contains disallowed SQL (subqueries, statements and comments are not permitted)",
    );
  }
  return trimmed;
}

export interface RawSearchEventsArgs {
  orgId: string;
  pipelineId: string;
  from: Date;
  to: Date;
  /** Raw ClickHouse boolean expression, ANDed with the mandatory org scope. */
  where: string;
  limit?: number;
}

/**
 * ADMIN-only raw search: the caller supplies a raw ClickHouse WHERE expression
 * (advanced filtering power) but org/pipeline/time/limit guardrails are always
 * enforced as bound predicates. The org predicate is non-negotiable and bound,
 * so cross-org reads remain impossible.
 */
export async function rawSearchEvents(args: RawSearchEventsArgs): Promise<LakeEvent[]> {
  if (!isLakeEnabled()) return [];

  const where = assertSafeRawWhere(args.where);
  const to = args.to;
  const from = clampFrom(args.from, to);
  const limit = clampLimit(args.limit, LAKE_DEFAULT_LIMIT, LAKE_MAX_LIMIT);

  const sql =
    `SELECT ${EVENT_COLUMNS} FROM ${LAKE_EVENTS_TABLE} ` +
    `WHERE organizationId = {orgId:String} AND pipelineId = {pipelineId:String} ` +
    `AND timestamp >= {from:DateTime64(3)} AND timestamp <= {to:DateTime64(3)} ` +
    `AND (${where}) ` +
    `ORDER BY timestamp DESC LIMIT {limit:UInt32} ` +
    lakeSettingsClause();

  return lakeQuery<LakeEvent>(sql, {
    orgId: args.orgId,
    pipelineId: args.pipelineId,
    from,
    to,
    limit,
  });
}

export type LakeFieldKind = "column" | "attr";
export interface LakeSchemaField {
  name: string;
  type: string;
  kind: LakeFieldKind;
}

/** Fixed `lake_events` columns, always present in every dataset. */
const STATIC_SCHEMA: ReadonlyArray<LakeSchemaField> = [
  { name: "eventType", type: "Enum8('log','metric','trace')", kind: "column" },
  { name: "timestamp", type: "DateTime64(3)", kind: "column" },
  { name: "traceId", type: "String", kind: "column" },
  { name: "spanId", type: "String", kind: "column" },
  { name: "host", type: "String", kind: "column" },
  { name: "source", type: "String", kind: "column" },
  { name: "severity", type: "String", kind: "column" },
  { name: "message", type: "String", kind: "column" },
  { name: "raw", type: "String", kind: "column" },
];

/**
 * Discover a dataset's schema: the fixed event columns plus the dynamic
 * `attrs` keys present in a bounded recent sample of the org+pipeline's events.
 * Org-scoped (bound param) and bounded (sample LIMIT + SETTINGS caps).
 */
export async function getSchema(args: {
  orgId: string;
  pipelineId: string;
}): Promise<LakeSchemaField[]> {
  if (!isLakeEnabled()) return [];

  const sql =
    `SELECT DISTINCT arrayJoin(mapKeys(attrs)) AS field FROM (` +
    `SELECT attrs FROM ${LAKE_EVENTS_TABLE} ` +
    `WHERE organizationId = {orgId:String} AND pipelineId = {pipelineId:String} ` +
    `ORDER BY timestamp DESC LIMIT {sample:UInt32}` +
    `) ORDER BY field LIMIT {fieldLimit:UInt32} ` +
    lakeSettingsClause();

  const rows = await lakeQuery<{ field: string }>(sql, {
    orgId: args.orgId,
    pipelineId: args.pipelineId,
    sample: SCHEMA_SAMPLE_ROWS,
    fieldLimit: SCHEMA_FIELD_LIMIT,
  });

  const attrFields: LakeSchemaField[] = rows
    .filter((r) => typeof r.field === "string" && r.field.length > 0)
    .map((r) => ({ name: `attrs.${r.field}`, type: "String", kind: "attr" as const }));

  return [...STATIC_SCHEMA, ...attrFields];
}

export interface FieldStat {
  value: string;
  count: number;
}

/** Columns whose name may be used directly as a SQL identifier in fieldStats —
 *  an allowlist, so an attacker can never inject an arbitrary identifier. The
 *  `=== true` membership test below is prototype-safe: inherited keys
 *  (`toString`, `constructor`, …) resolve to functions, never `true`. */
const STAT_COLUMN_ALLOWLIST: Record<string, true> = {
  eventType: true,
  host: true,
  source: true,
  severity: true,
  traceId: true,
  spanId: true,
  message: true,
};

/**
 * Resolve a user-supplied field name to a safe SQL expression. Known columns
 * come from a fixed allowlist (safe identifier); anything else is treated as a
 * dynamic `attrs` key and bound as a parameter (`attrs[{field:String}]`), so an
 * arbitrary field name can never be interpolated into the SQL text.
 */
function fieldStatExpr(field: string): { expr: string; attrKey?: string } {
  if (STAT_COLUMN_ALLOWLIST[field] === true) {
    return { expr: `toString(${field})` };
  }
  const attrKey = field.startsWith("attrs.") ? field.slice("attrs.".length) : field;
  return { expr: "attrs[{field:String}]", attrKey };
}

/**
 * Top values (with counts) for a single field over the org+pipeline+time
 * window — powers the schema/field browser. Org-scoped and capped.
 */
export async function fieldStats(args: {
  orgId: string;
  pipelineId: string;
  field: string;
  from: Date;
  to: Date;
  limit?: number;
}): Promise<FieldStat[]> {
  if (!isLakeEnabled()) return [];

  const to = args.to;
  const from = clampFrom(args.from, to);
  const limit = clampLimit(args.limit, FIELD_STATS_DEFAULT_LIMIT, FIELD_STATS_MAX_LIMIT);
  const { expr, attrKey } = fieldStatExpr(args.field);

  const params: Record<string, unknown> = {
    orgId: args.orgId,
    pipelineId: args.pipelineId,
    from,
    to,
    limit,
  };
  if (attrKey !== undefined) {
    params.field = attrKey;
  }

  const sql =
    `SELECT ${expr} AS value, count() AS count FROM ${LAKE_EVENTS_TABLE} ` +
    `WHERE organizationId = {orgId:String} AND pipelineId = {pipelineId:String} ` +
    `AND timestamp >= {from:DateTime64(3)} AND timestamp <= {to:DateTime64(3)} ` +
    `GROUP BY value ORDER BY count DESC LIMIT {limit:UInt32} ` +
    lakeSettingsClause();

  const rows = await lakeQuery<{ value: string | null; count: string | number }>(sql, params);
  return rows.map((r) => ({ value: String(r.value ?? ""), count: Number(r.count ?? 0) }));
}

/** A catalog dataset row with its pipeline/environment/retention labels. */
export type LakeDatasetListItem = Prisma.LakeDatasetGetPayload<{
  include: {
    pipeline: { select: { id: true; name: true } };
    environment: { select: { id: true; name: true } };
    retentionPolicy: { select: { id: true; name: true; hotDays: true; coldDays: true } };
  };
}>;

/**
 * List the org's lake datasets from the Postgres catalog (no ClickHouse read).
 * Always org-filtered; returns an empty list when the lake is disabled.
 */
export async function listDatasets(args: { orgId: string }): Promise<LakeDatasetListItem[]> {
  if (!isLakeEnabled()) return [];

  return prisma.lakeDataset.findMany({
    where: { organizationId: args.orgId },
    include: {
      pipeline: { select: { id: true, name: true } },
      environment: { select: { id: true, name: true } },
      retentionPolicy: { select: { id: true, name: true, hotDays: true, coldDays: true } },
    },
    orderBy: [{ lastEventAt: "desc" }, { createdAt: "desc" }],
  });
}
