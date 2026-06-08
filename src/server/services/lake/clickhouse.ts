import { createClient, type ClickHouseClient } from "@clickhouse/client";

import { env } from "@/lib/env";

/**
 * VectorFlow Lake — thin ClickHouse connection layer (A1).
 *
 * STRICT NO-OP CONTRACT: importing this module connects to nothing and never
 * throws. When `VF_LAKE_CLICKHOUSE_URL` is unset the lake is disabled — the
 * default for every non-lake deployment — so the rest of the app is completely
 * unaffected. `isLakeEnabled()` is `false`, and the data-access helpers throw a
 * clear error ONLY when CALLED while disabled.
 *
 * Config is read from `process.env` at call time (the VF_LAKE_* vars are
 * declared/validated in src/lib/env.ts). Reading `process.env` directly — rather
 * than the validated `env` singleton — keeps the standalone migration runner
 * (scripts/lake-migrate.ts, run via tsx) decoupled from full app-env validation,
 * mirroring src/lib/redis.ts and src/server/services/kms.
 *
 * This is intentionally a THIN layer: connection + raw query/insert/ping only.
 * Query/search/catalog logic belongs to a later phase.
 */

/** Default ClickHouse database for the lake. Mirrors the `.default()` for
 *  VF_LAKE_CLICKHOUSE_DATABASE in src/lib/env.ts. */
export const DEFAULT_LAKE_DATABASE = "vectorflow_lake";

const LAKE_DISABLED_MESSAGE =
  "VectorFlow Lake is not configured (VF_LAKE_CLICKHOUSE_URL unset)";

export interface LakeS3Config {
  /** S3 endpoint host (e.g. https://s3.us-east-1.amazonaws.com). */
  endpoint: string | undefined;
  bucket: string;
  region: string | undefined;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
}

export interface LakeConfig {
  url: string;
  username: string | undefined;
  password: string | undefined;
  database: string;
  /** Non-null only when the S3 cold tier is configured (VF_LAKE_S3_BUCKET set). */
  s3: LakeS3Config | null;
}

// globalThis cache — survives Next dev HMR (same pattern as src/lib/prisma.ts
// and src/lib/redis.ts) so a hot reload does not leak idle keep-alive sockets.
const globalForLake = globalThis as unknown as {
  __vfLakeClient?: ClickHouseClient;
};

/** True iff the lake is configured (VF_LAKE_CLICKHOUSE_URL set & non-empty). */
export function isLakeEnabled(): boolean {
  const url = process.env.VF_LAKE_CLICKHOUSE_URL;
  return typeof url === "string" && url.length > 0;
}

/** True iff the S3-backed cold tier is configured (VF_LAKE_S3_BUCKET set). */
export function isLakeColdTierEnabled(): boolean {
  const bucket = process.env.VF_LAKE_S3_BUCKET;
  return typeof bucket === "string" && bucket.length > 0;
}

/**
 * Resolve the lake configuration from the environment.
 * @throws {Error} when the lake is disabled — gate on `isLakeEnabled()` first.
 */
export function getLakeConfig(): LakeConfig {
  const url = process.env.VF_LAKE_CLICKHOUSE_URL;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(LAKE_DISABLED_MESSAGE);
  }
  return {
    url,
    username: process.env.VF_LAKE_CLICKHOUSE_USER || undefined,
    password: process.env.VF_LAKE_CLICKHOUSE_PASSWORD || undefined,
    database: process.env.VF_LAKE_CLICKHOUSE_DATABASE || DEFAULT_LAKE_DATABASE,
    s3: isLakeColdTierEnabled()
      ? {
          endpoint: process.env.VF_LAKE_S3_ENDPOINT || undefined,
          // Non-null by isLakeColdTierEnabled() above.
          bucket: process.env.VF_LAKE_S3_BUCKET as string,
          region: process.env.VF_LAKE_S3_REGION || undefined,
          accessKeyId: process.env.VF_LAKE_S3_ACCESS_KEY_ID || undefined,
          secretAccessKey: process.env.VF_LAKE_S3_SECRET_ACCESS_KEY || undefined,
        }
      : null,
  };
}

/**
 * Return the cached ClickHouse client, constructing it lazily on first call.
 * NEVER connects at import — only here, when explicitly called.
 * @throws {Error} with a clear message when the lake is disabled.
 */
export function getLakeClient(): ClickHouseClient {
  if (!isLakeEnabled()) {
    throw new Error(LAKE_DISABLED_MESSAGE);
  }
  if (globalForLake.__vfLakeClient) {
    return globalForLake.__vfLakeClient;
  }
  const config = getLakeConfig();
  const client = createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    application: "vectorflow",
    // Bound the per-client connection pool so the lake never opens unbounded
    // sockets under load. We keep a single cached client (above), so this pool
    // is the process-wide ceiling. Sourced from the centralized env module.
    max_open_connections: env.VF_LAKE_CH_POOL_MAX,
    // Fail slow lake requests instead of hanging a held connection.
    request_timeout: env.VF_LAKE_CH_REQUEST_TIMEOUT_MS,
    // Reuse sockets across requests (HTTP keep-alive) — default in
    // @clickhouse/client@1.x; set explicitly to document the intent.
    keep_alive: { enabled: true },
  });
  globalForLake.__vfLakeClient = client;
  return client;
}

/**
 * Run a read query and parse rows as JSON. Uses `JSONEachRow` so the result is a
 * flat `T[]`. `params` binds ClickHouse query parameters (`{name:Type}`
 * placeholders) — always prefer parameter binding over string interpolation.
 */
export async function lakeQuery<T = unknown>(
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const resultSet = await getLakeClient().query({
    query: sql,
    format: "JSONEachRow",
    query_params: params,
  });
  return resultSet.json<T>();
}

/** Insert rows into a lake table (JSONEachRow). No-op for an empty batch. */
export async function lakeInsert<T = Record<string, unknown>>(
  table: string,
  rows: ReadonlyArray<T>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await getLakeClient().insert<T>({
    table,
    values: rows,
    format: "JSONEachRow",
  });
}

/** Health check — resolves `true` iff the lake responds to a ping. */
export async function lakePing(): Promise<boolean> {
  const result = await getLakeClient().ping();
  return result.success;
}

/**
 * Close and clear the cached client. Safe to call when disabled (no-op).
 * Used by graceful shutdown and tests.
 */
export async function closeLakeClient(): Promise<void> {
  const client = globalForLake.__vfLakeClient;
  if (client) {
    globalForLake.__vfLakeClient = undefined;
    await client.close();
  }
}
