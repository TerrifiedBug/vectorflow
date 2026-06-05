/**
 * Managed "VectorFlow Lake" sink (A2).
 *
 * The lake sink is a curated preset that renders to Vector's native `clickhouse`
 * sink targeting the managed `lake_events` table. Its connection fields
 * (endpoint / database / credentials) are NEVER stored in the pipeline graph:
 * the generator emits `LAKE[...]` placeholder tokens and the control plane
 * resolves them to concrete values from the server's lake config at
 * config-delivery time — mirroring how `SECRET[...]` refs are injected.
 *
 * Everything here is pure and side-effect free so it is shared by the YAML
 * generator (rendering), the agent config route (delivery resolution) and the
 * ingest catalog hook (detection). It NEVER imports the ClickHouse client.
 */

/** Catalog `type` for the lake preset in the component palette / editor graph. */
export const LAKE_SINK_TYPE = "vectorflow_lake";

/** Managed ClickHouse table backing the lake (matches the A1 DDL). */
export const LAKE_EVENTS_TABLE = "lake_events";

const LAKE_ENDPOINT_REF = "LAKE[endpoint]";
const LAKE_DATABASE_REF = "LAKE[database]";
const LAKE_USER_REF = "LAKE[user]";
const LAKE_PASSWORD_REF = "LAKE[password]";

/** Matches a lake placeholder token, e.g. `LAKE[endpoint]`. */
const LAKE_REF_PATTERN = /^LAKE\[(?:endpoint|database|user|password)\]$/;

/** Concrete lake connection values resolved at delivery (from `getLakeConfig()`). */
export interface LakeSinkCreds {
  endpoint: string;
  database: string;
  username?: string;
  password?: string;
}

/**
 * The Vector `clickhouse` sink block the lake preset renders to. Connection
 * fields are left as `LAKE[...]` placeholders; `inputs` are added by the YAML
 * generator from graph edges. Full-fidelity ingest: `json_each_row` plus lenient
 * timestamp/field parsing so logs, metrics and traces all land untouched.
 */
export function renderLakeSinkBlock(): Record<string, unknown> {
  return {
    type: "clickhouse",
    endpoint: LAKE_ENDPOINT_REF,
    database: LAKE_DATABASE_REF,
    table: LAKE_EVENTS_TABLE,
    format: "json_each_row",
    date_time_best_effort: true,
    skip_unknown_fields: true,
    auth: {
      strategy: "basic",
      user: LAKE_USER_REF,
      password: LAKE_PASSWORD_REF,
    },
  };
}

function isLakeRef(value: unknown): value is string {
  return typeof value === "string" && LAKE_REF_PATTERN.test(value);
}

/** True iff `block` is the managed lake sink (a `clickhouse` sink carrying LAKE refs). */
function isLakeSinkBlock(block: unknown): block is Record<string, unknown> {
  if (!block || typeof block !== "object" || Array.isArray(block)) return false;
  const b = block as Record<string, unknown>;
  if (b.type !== "clickhouse") return false;
  return Object.values(b).some(
    (v) =>
      isLakeRef(v) ||
      (v != null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        Object.values(v as Record<string, unknown>).some(isLakeRef)),
  );
}

/**
 * True iff any sink in a parsed Vector config is the managed lake sink. Used by
 * the ingest catalog hook to decide whether a pipeline routes to the lake.
 */
export function configHasLakeSink(config: Record<string, unknown>): boolean {
  const sinks = config.sinks;
  if (!sinks || typeof sinks !== "object" || Array.isArray(sinks)) return false;
  return Object.values(sinks as Record<string, unknown>).some(isLakeSinkBlock);
}

function resolveLakeValue(token: string, creds: LakeSinkCreds): string | undefined {
  switch (token) {
    case LAKE_ENDPOINT_REF:
      return creds.endpoint;
    case LAKE_DATABASE_REF:
      return creds.database;
    case LAKE_USER_REF:
      return creds.username;
    case LAKE_PASSWORD_REF:
      return creds.password;
    default:
      return undefined;
  }
}

function resolveAuthBlock(
  auth: Record<string, unknown>,
  creds: LakeSinkCreds,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(auth)) {
    if (isLakeRef(value)) {
      const resolved = resolveLakeValue(value, creds);
      if (resolved !== undefined) out[key] = resolved;
      continue;
    }
    out[key] = value;
  }
  // With no user/password/token, the ClickHouse server is unauthenticated —
  // drop auth entirely rather than send a half-populated basic-auth block.
  if (out.user === undefined && out.password === undefined && out.token === undefined) {
    return null;
  }
  return out;
}

function resolveLakeBlock(
  block: Record<string, unknown>,
  creds: LakeSinkCreds,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    if (isLakeRef(value)) {
      const resolved = resolveLakeValue(value, creds);
      if (resolved !== undefined) out[key] = resolved;
      continue;
    }
    if (key === "auth" && value && typeof value === "object" && !Array.isArray(value)) {
      const auth = resolveAuthBlock(value as Record<string, unknown>, creds);
      if (auth) out[key] = auth;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Resolve managed lake sinks in a delivery config:
 *  - `creds` present (lake enabled): replace `LAKE[...]` refs with the concrete
 *    endpoint/database/credentials; drop credential fields that are unset and
 *    drop the `auth` block when the server is unauthenticated.
 *  - `creds` null (lake disabled): rewrite each lake sink to a no-op `blackhole`
 *    sink so the delivered config stays valid and the lake is fully inert — no
 *    connection is attempted, the topology and upstream transforms are
 *    preserved, and nothing is left dangling.
 *
 * Returns a new config object (original untouched) and whether any lake sink was
 * found. `applied: false` means the config has no lake sink — leave it as-is.
 */
export function resolveLakeSinkForDelivery(
  config: Record<string, unknown>,
  creds: LakeSinkCreds | null,
): { config: Record<string, unknown>; applied: boolean } {
  const sinks = config.sinks;
  if (!sinks || typeof sinks !== "object" || Array.isArray(sinks)) {
    return { config, applied: false };
  }

  const sinkMap = sinks as Record<string, unknown>;
  // Clone lazily — only when a lake sink is actually present, so the common
  // (no-lake) delivery path allocates nothing.
  let nextSinks: Record<string, unknown> | null = null;

  for (const [key, block] of Object.entries(sinkMap)) {
    if (!isLakeSinkBlock(block)) continue;
    if (!nextSinks) nextSinks = { ...sinkMap };
    const b = block as Record<string, unknown>;
    if (!creds) {
      nextSinks[key] = Array.isArray(b.inputs)
        ? { type: "blackhole", inputs: b.inputs }
        : { type: "blackhole" };
      continue;
    }
    nextSinks[key] = resolveLakeBlock(b, creds);
  }

  if (!nextSinks) return { config, applied: false };
  return { config: { ...config, sinks: nextSinks }, applied: true };
}
