/**
 * VectorFlow Lake — ClickHouse migration runner (A1), as an importable module.
 *
 * `runLakeMigrations()` ensures the lake database exists and applies every
 * `scripts/lake-migrations/*.sql` in lexical order. DDL uses CREATE ... IF NOT
 * EXISTS, so re-running is a no-op. It is a NO-OP (returns `{ skipped: true }`)
 * when the lake is disabled (`VF_LAKE_CLICKHOUSE_URL` unset), so it is safe to
 * call unconditionally on boot.
 *
 * Two callers:
 *   - the CLI wrapper `scripts/lake-migrate.ts` (run via `pnpm tsx`), and
 *   - the cloud managed-lake bootstrap (`cloud/src/services/lake/managed-lake.ts`),
 *     which runs it once on the elected leader.
 *
 * Each .sql file is templated before execution:
 *   {database} → VF_LAKE_CLICKHOUSE_DATABASE (default "vectorflow_lake")
 *   {ttl}      → retention/tiering clause:
 *                  • cold tier enabled  → TTL move-to-cold + DELETE plus
 *                    SETTINGS storage_policy='vf_hot_cold' (hot MergeTree + S3
 *                    cold disk).
 *                  • cold tier disabled → TTL DELETE only (plain MergeTree,
 *                    runs on a vanilla ClickHouse).
 *
 * NOTE (packaging): the cloud server image must include `scripts/lake-migrations/`
 * for the bootstrap path; the directory is resolved relative to `process.cwd()`.
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  isLakeEnabled,
  isLakeColdTierEnabled,
  getLakeClient,
  getLakeConfig,
} from "@/server/services/lake/clickhouse";
import { effectiveRetention, buildLakeTtlClause } from "@/server/services/lake/lake-retention";

export interface LakeMigrationResult {
  /** True when the lake is disabled and nothing was applied. */
  skipped: boolean;
  /** Number of .sql migration files applied. */
  files: number;
  /** Total ClickHouse statements executed. */
  statements: number;
}

function migrationsDir(): string {
  return join(process.cwd(), "scripts", "lake-migrations");
}

/**
 * Apply all lake migrations idempotently. No-ops when the lake is disabled.
 * Throws on a ClickHouse error (the caller decides whether that is fatal).
 */
export async function runLakeMigrations(): Promise<LakeMigrationResult> {
  if (!isLakeEnabled()) {
    return { skipped: true, files: 0, statements: 0 };
  }

  const config = getLakeConfig();
  // The base table TTL flows through the same per-dataset retention helpers, so
  // the table default (LAKE_DEFAULT_HOT/COLD_DAYS = 7/90) and any per-dataset
  // window share one TTL-clause shape. No policy here → the defaults.
  const ttlClause = buildLakeTtlClause(effectiveRetention(null), isLakeColdTierEnabled());

  const client = getLakeClient();

  // Ensure the target database exists before applying table DDL.
  await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${config.database}` });

  const files = readdirSync(migrationsDir())
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let statements = 0;
  for (const file of files) {
    // Strip full-line `--` comments (the file header documents the {database}
    // and {ttl} tokens, and {ttl} expands to multiple lines), substitute tokens,
    // then split into individual statements.
    const fileStatements = readFileSync(join(migrationsDir(), file), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .replace(/\{database\}/g, config.database)
      .replace(/\{ttl\}/g, ttlClause)
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of fileStatements) {
      await client.command({ query: statement });
    }
    statements += fileStatements.length;
  }

  return { skipped: false, files: files.length, statements };
}
