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
 * Resolve a user-supplied field name to a safe SQL expression with a
 * caller-chosen bound-param name. Known columns come from a fixed allowlist
 * (safe identifier); anything else is a dynamic `attrs` key bound as a
 * parameter (`attrs[{<paramName>:String}]`), so an arbitrary field name can
 * never be interpolated into the SQL text. A distinct `paramName` lets one
 * query reference two dynamic fields (group + metric) without param collision.
 */
function fieldExprWithParam(
  field: string,
  paramName: string,
): { expr: string; param?: { name: string; value: string } } {
  if (STAT_COLUMN_ALLOWLIST[field] === true) {
    return { expr: `toString(${field})` };
  }
  const attrKey = field.startsWith("attrs.") ? field.slice("attrs.".length) : field;
  return { expr: `attrs[{${paramName}:String}]`, param: { name: paramName, value: attrKey } };
}

/** fieldStats variant: resolves against the fixed `field` bound-param name. */
function fieldStatExpr(field: string): { expr: string; attrKey?: string } {
  const resolved = fieldExprWithParam(field, "field");
  return { expr: resolved.expr, attrKey: resolved.param?.value };
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

// ── Summarize (aggregation) ──────────────────────────────────────────────────
/** Aggregate functions exposed by `summarizeEvents`. `count` needs no field;
 *  `count_distinct` operates on the raw field; the rest coerce the field to a
 *  number via `toFloat64OrNull` first. */
export const LAKE_AGG_FUNCTIONS = [
  "count",
  "count_distinct",
  "sum",
  "avg",
  "min",
  "max",
  "p50",
  "p95",
  "p99",
] as const;
export type LakeAggFunction = (typeof LAKE_AGG_FUNCTIONS)[number];

/** Time-bucket widths a summarize query may use (seconds). The router/UI pick
 *  one from the range; the engine clamps to this set + a max-bucket cap so a
 *  query can never emit an unbounded number of points. */
export const LAKE_BUCKET_SECONDS = [
  10, 30, 60, 300, 900, 1800, 3600, 21600, 86400,
] as const;
/** Hard cap on time buckets per summarize query (result-row backstop). */
const LAKE_SUMMARIZE_MAX_BUCKETS = 2000;
/** Default + max number of top-N grouped series. */
const LAKE_SUMMARIZE_DEFAULT_SERIES = 10;
export const LAKE_SUMMARIZE_MAX_SERIES = 50;

/** Thrown when summarize arguments are invalid (e.g. a numeric metric with no
 *  field). The router maps this to BAD_REQUEST. */
export class LakeSummarizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LakeSummarizeError";
  }
}

/**
 * Pick a safe bucket width: honour the caller's request when it is in the
 * allowed set and coarse enough to stay under the bucket cap; otherwise fall to
 * the smallest allowed bucket that keeps the point count bounded.
 */
function clampBucketSeconds(bucketSeconds: number | undefined, from: Date, to: Date): number {
  const rangeSec = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 1000));
  const minAllowed = Math.ceil(rangeSec / LAKE_SUMMARIZE_MAX_BUCKETS);
  const coarsestFit =
    LAKE_BUCKET_SECONDS.find((b) => b >= minAllowed) ??
    LAKE_BUCKET_SECONDS[LAKE_BUCKET_SECONDS.length - 1];
  if (typeof bucketSeconds === "number" && Number.isFinite(bucketSeconds)) {
    const requested = Math.floor(bucketSeconds);
    if (
      (LAKE_BUCKET_SECONDS as readonly number[]).includes(requested) &&
      requested >= minAllowed
    ) {
      return requested;
    }
  }
  return coarsestFit;
}

/**
 * Build the aggregate SQL expression for a metric, binding the metric field as
 * a parameter when needed. Throws `LakeSummarizeError` for a numeric/distinct
 * metric with no field. Never interpolates raw field text — the field resolves
 * through the column allowlist or a bound `attrs[...]` param.
 */
function buildAggExpr(
  metric: LakeAggFunction,
  metricField: string | undefined,
  params: Record<string, unknown>,
): string {
  if (metric === "count") {
    return "count()";
  }
  const field = metricField?.trim();
  if (!field) {
    throw new LakeSummarizeError(`Metric '${metric}' requires a metric field`);
  }
  const resolved = fieldExprWithParam(field, "metricField");
  if (resolved.param) {
    params[resolved.param.name] = resolved.param.value;
  }
  if (metric === "count_distinct") {
    return `uniqExact(${resolved.expr})`;
  }
  const numeric = `toFloat64OrNull(${resolved.expr})`;
  switch (metric) {
    case "sum":
      return `sum(${numeric})`;
    case "avg":
      return `avg(${numeric})`;
    case "min":
      return `min(${numeric})`;
    case "max":
      return `max(${numeric})`;
    case "p50":
      return `quantile(0.5)(${numeric})`;
    case "p95":
      return `quantile(0.95)(${numeric})`;
    case "p99":
      return `quantile(0.99)(${numeric})`;
    default:
      throw new LakeSummarizeError(`Unsupported metric '${metric}'`);
  }
}

/** A single (bucket, series) aggregate point. `series` is "" when ungrouped. */
export interface LakeSummaryPoint {
  bucket: string;
  series: string;
  value: number;
}

export interface SummarizeEventsArgs {
  orgId: string;
  pipelineId: string;
  from: Date;
  to: Date;
  eventType?: LakeEventType;
  /** Free-text term matched (case-insensitive) against `message` and `raw`. */
  query?: string;
  /** Optional group-by field (column allowlist or dynamic attr key). */
  groupBy?: string;
  metric: LakeAggFunction;
  /** Field to aggregate; required for every metric except `count`. */
  metricField?: string;
  bucketSeconds?: number;
  /** Top-N grouped series to return (by aggregate over the whole window). */
  seriesLimit?: number;
}

/**
 * Time-bucketed aggregation over an org+pipeline window — count-over-time,
 * group-by + top-N, and numeric aggregates (sum/avg/min/max/percentiles).
 * Security mirrors `fieldStats`/`searchEvents` exactly: org/pipeline/time are
 * bound params; `groupBy`/`metricField` resolve through the column allowlist or
 * a bound `attrs[...]` param; `metric`/`bucketSeconds`/`seriesLimit` are
 * enums/clamped ints — no raw user text ever reaches the SQL.
 */
export async function summarizeEvents(args: SummarizeEventsArgs): Promise<LakeSummaryPoint[]> {
  if (!isLakeEnabled()) return [];

  const to = args.to;
  const from = clampFrom(args.from, to);
  const bucketSec = clampBucketSeconds(args.bucketSeconds, from, to);

  const params: Record<string, unknown> = {
    orgId: args.orgId,
    pipelineId: args.pipelineId,
    from,
    to,
    bucketSec,
  };

  const aggExpr = buildAggExpr(args.metric, args.metricField, params);

  const conditions = [
    "organizationId = {orgId:String}",
    "pipelineId = {pipelineId:String}",
    "timestamp >= {from:DateTime64(3)}",
    "timestamp <= {to:DateTime64(3)}",
  ];
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
  const whereClause = conditions.join(" AND ");
  const bucketExpr = "toStartOfInterval(timestamp, toIntervalSecond({bucketSec:UInt32}))";

  const groupBy = args.groupBy?.trim();
  let sql: string;
  if (!groupBy) {
    sql =
      `SELECT ${bucketExpr} AS bucket, '' AS series, ${aggExpr} AS value ` +
      `FROM ${LAKE_EVENTS_TABLE} WHERE ${whereClause} ` +
      `GROUP BY bucket ORDER BY bucket ASC ` +
      lakeSettingsClause();
  } else {
    const seriesLimit = clampLimit(
      args.seriesLimit,
      LAKE_SUMMARIZE_DEFAULT_SERIES,
      LAKE_SUMMARIZE_MAX_SERIES,
    );
    params.seriesLimit = seriesLimit;
    const resolved = fieldExprWithParam(groupBy, "groupField");
    if (resolved.param) {
      params[resolved.param.name] = resolved.param.value;
    }
    const seriesExpr = resolved.expr;
    // Restrict to the top-N series by aggregate over the whole window, then
    // bucket within those series. The inner subquery reuses the same bound
    // params (org/pipeline/time/field), so it adds no injection surface.
    sql =
      `SELECT ${bucketExpr} AS bucket, ${seriesExpr} AS series, ${aggExpr} AS value ` +
      `FROM ${LAKE_EVENTS_TABLE} WHERE ${whereClause} AND ${seriesExpr} IN (` +
      `SELECT ${seriesExpr} AS series FROM ${LAKE_EVENTS_TABLE} WHERE ${whereClause} ` +
      `GROUP BY series ORDER BY ${aggExpr} DESC LIMIT {seriesLimit:UInt32}` +
      `) GROUP BY bucket, series ORDER BY bucket ASC, series ASC ` +
      lakeSettingsClause();
  }

  const rows = await lakeQuery<{
    bucket: string;
    series: string | null;
    value: string | number | null;
  }>(sql, params);
  return rows.map((r) => ({
    bucket: r.bucket,
    series: String(r.series ?? ""),
    value: Number(r.value ?? 0),
  }));
}

export interface AggregateValueArgs {
  orgId: string;
  pipelineId: string;
  from: Date;
  to: Date;
  eventType?: LakeEventType;
  query?: string;
  metric: LakeAggFunction;
  metricField?: string;
}

/**
 * Single scalar aggregate over an org+pipeline window (no time bucketing) — the
 * primitive backing scheduled threshold alerts. Same safe query shape as
 * `summarizeEvents` (org/pipeline/time bound; metric via the allowlist/bound
 * param). Returns null when the lake is disabled or the aggregate is undefined
 * (e.g. avg over no numeric values). `count`/`count_distinct` return 0 for an
 * empty window, so a count alert never silently no-ops.
 */
export async function aggregateValue(args: AggregateValueArgs): Promise<number | null> {
  if (!isLakeEnabled()) return null;

  const to = args.to;
  const from = clampFrom(args.from, to);
  const params: Record<string, unknown> = {
    orgId: args.orgId,
    pipelineId: args.pipelineId,
    from,
    to,
  };
  const aggExpr = buildAggExpr(args.metric, args.metricField, params);

  const conditions = [
    "organizationId = {orgId:String}",
    "pipelineId = {pipelineId:String}",
    "timestamp >= {from:DateTime64(3)}",
    "timestamp <= {to:DateTime64(3)}",
  ];
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
    `SELECT ${aggExpr} AS value FROM ${LAKE_EVENTS_TABLE} ` +
    `WHERE ${conditions.join(" AND ")} ` +
    lakeSettingsClause();

  const rows = await lakeQuery<{ value: string | number | null }>(sql, params);
  const v = rows[0]?.value;
  return v === null || v === undefined ? null : Number(v);
}

// ── Traces (lightweight trace-grouped view) ──────────────────────────────────
const LAKE_TRACES_DEFAULT_LIMIT = 100;
const LAKE_TRACES_MAX_LIMIT = 1_000;
/** Span cap for a single trace (a runaway trace can't exhaust the page). */
const LAKE_TRACE_SPANS_MAX = 2_000;

/** Best-effort attr keys for span name / parent / duration (schema-on-read).
 *  Documented in the Lake guide; extend here as new emitters surface. */
const SPAN_NAME_ATTRS = ["name", "span_name", "operation", "operation_name"];
const SPAN_PARENT_ATTRS = ["parent_span_id", "parent_id", "parentSpanId", "parentId"];
const SPAN_DURATION_ATTRS = ["duration_ms", "durationMs", "duration", "elapsed_ms", "latency_ms"];

function firstAttr(attrs: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** One trace, grouped from its spans (no waterfall — counts + wall-time). */
export interface LakeTraceSummary {
  traceId: string;
  spanCount: number;
  startTime: string;
  endTime: string;
  /** Wall-time across spans (max - min span start), milliseconds. */
  durationMs: number;
  /** "error" iff any span's severity looks error-like, else "ok". */
  status: string;
}

/**
 * Recent distinct traces over an org+pipeline window: span count, wall-time and
 * a coarse status, grouped by `traceId`. Same safe query shape as
 * `searchEvents` (org/pipeline/time bound params; eventType pinned to 'trace').
 */
export async function listTraces(args: {
  orgId: string;
  pipelineId: string;
  from: Date;
  to: Date;
  limit?: number;
}): Promise<LakeTraceSummary[]> {
  if (!isLakeEnabled()) return [];

  const to = args.to;
  const from = clampFrom(args.from, to);
  const limit = clampLimit(args.limit, LAKE_TRACES_DEFAULT_LIMIT, LAKE_TRACES_MAX_LIMIT);

  const sql =
    `SELECT traceId, count() AS spanCount, ` +
    `min(timestamp) AS startTime, max(timestamp) AS endTime, ` +
    `dateDiff('millisecond', min(timestamp), max(timestamp)) AS durationMs, ` +
    `if(countIf(positionCaseInsensitive(severity, 'error') > 0) > 0, 'error', 'ok') AS status ` +
    `FROM ${LAKE_EVENTS_TABLE} ` +
    `WHERE organizationId = {orgId:String} AND pipelineId = {pipelineId:String} ` +
    `AND timestamp >= {from:DateTime64(3)} AND timestamp <= {to:DateTime64(3)} ` +
    `AND eventType = 'trace' AND traceId != '' ` +
    `GROUP BY traceId ORDER BY startTime DESC LIMIT {limit:UInt32} ` +
    lakeSettingsClause();

  const rows = await lakeQuery<{
    traceId: string;
    spanCount: string | number;
    startTime: string;
    endTime: string;
    durationMs: string | number;
    status: string;
  }>(sql, { orgId: args.orgId, pipelineId: args.pipelineId, from, to, limit });

  return rows.map((r) => ({
    traceId: r.traceId,
    spanCount: Number(r.spanCount ?? 0),
    startTime: r.startTime,
    endTime: r.endTime,
    durationMs: Number(r.durationMs ?? 0),
    status: r.status === "error" ? "error" : "ok",
  }));
}

/** One span of a trace, with name/parent/duration resolved best-effort from attrs. */
export interface LakeTraceSpan {
  spanId: string;
  parentSpanId: string;
  name: string;
  startTime: string;
  durationMs: number | null;
  severity: string;
  attrs: Record<string, string>;
}

/**
 * All spans of a single trace, ordered by start time. Span name/parent/duration
 * are read from `attrs` (schema-on-read; see SPAN_*_ATTRS). Org/pipeline/traceId
 * are bound params; eventType is pinned to 'trace'.
 */
export async function getTrace(args: {
  orgId: string;
  pipelineId: string;
  traceId: string;
}): Promise<LakeTraceSpan[]> {
  if (!isLakeEnabled() || !args.traceId) return [];

  const sql =
    `SELECT spanId, message, severity, timestamp, attrs FROM ${LAKE_EVENTS_TABLE} ` +
    `WHERE organizationId = {orgId:String} AND pipelineId = {pipelineId:String} ` +
    `AND traceId = {traceId:String} AND eventType = 'trace' ` +
    `ORDER BY timestamp ASC LIMIT {limit:UInt32} ` +
    lakeSettingsClause();

  const rows = await lakeQuery<{
    spanId: string;
    message: string;
    severity: string;
    timestamp: string;
    attrs: Record<string, string>;
  }>(sql, {
    orgId: args.orgId,
    pipelineId: args.pipelineId,
    traceId: args.traceId,
    limit: LAKE_TRACE_SPANS_MAX,
  });

  return rows.map((r) => {
    const attrs = r.attrs ?? {};
    const durStr = firstAttr(attrs, SPAN_DURATION_ATTRS);
    const durationMs =
      durStr !== undefined && Number.isFinite(Number(durStr)) ? Number(durStr) : null;
    return {
      spanId: r.spanId,
      parentSpanId: firstAttr(attrs, SPAN_PARENT_ATTRS) ?? "",
      name: firstAttr(attrs, SPAN_NAME_ATTRS) ?? (r.message || r.spanId || "span"),
      startTime: r.timestamp,
      durationMs,
      severity: r.severity,
      attrs,
    };
  });
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
