/**
 * VectorFlow Lake — ClickHouse migration runner (A1).
 *
 * Idempotent: connects via the lake wrapper, ensures the target database exists,
 * and applies every scripts/lake-migrations/*.sql in lexical order. DDL uses
 * CREATE ... IF NOT EXISTS, so re-running is a no-op.
 *
 * NO-OP when disabled: if VF_LAKE_CLICKHOUSE_URL is unset, prints a message and
 * exits 0 without connecting to anything — safe to wire into a boot/migrate step
 * on non-lake deployments.
 *
 * Each .sql file is templated before execution:
 *   {database} → VF_LAKE_CLICKHOUSE_DATABASE (default "vectorflow_lake")
 *   {ttl}      → retention/tiering clause:
 *                  • VF_LAKE_S3_BUCKET set   → TTL move-to-cold + DELETE plus
 *                    SETTINGS storage_policy='vf_hot_cold' (hot MergeTree + S3
 *                    cold disk, configured in docker/server/clickhouse/).
 *                  • VF_LAKE_S3_BUCKET unset → TTL DELETE only (plain MergeTree,
 *                    runs on a vanilla ClickHouse).
 *
 * Usage:
 *   pnpm tsx scripts/lake-migrate.ts
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  isLakeEnabled,
  isLakeColdTierEnabled,
  getLakeClient,
  getLakeConfig,
  closeLakeClient,
} from "../src/server/services/lake/clickhouse";

// Default hot/cold retention windows for the base DDL. These mirror the
// LakeRetentionPolicy defaults (hotDays=7, coldDays=90) in prisma/schema.prisma;
// per-dataset retention is governed by that catalog model at a higher layer.
const HOT_DAYS = 7;
const COLD_DAYS = 90;

const MIGRATIONS_DIR = join(process.cwd(), "scripts", "lake-migrations");

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

async function main(): Promise<void> {
  if (!isLakeEnabled()) {
    log(
      "VectorFlow Lake is disabled (VF_LAKE_CLICKHOUSE_URL unset) — nothing to migrate.",
    );
    return;
  }

  const config = getLakeConfig();
  const coldTier = isLakeColdTierEnabled();
  const ttlClause = coldTier
    ? `TTL toDateTime(timestamp) + INTERVAL ${HOT_DAYS} DAY TO VOLUME 'cold', ` +
      `toDateTime(timestamp) + INTERVAL ${COLD_DAYS} DAY DELETE\n` +
      `SETTINGS storage_policy = 'vf_hot_cold'`
    : `TTL toDateTime(timestamp) + INTERVAL ${COLD_DAYS} DAY DELETE`;

  log("\nVectorFlow Lake migration");
  log("=".repeat(60));
  log(`  database:  ${config.database}`);
  log(
    `  cold tier: ${
      coldTier
        ? `enabled (bucket ${config.s3?.bucket}) — hot MergeTree + S3 cold disk`
        : "disabled — hot-only MergeTree (TTL delete)"
    }`,
  );

  const client = getLakeClient();

  // Ensure the target database exists before applying table DDL.
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${config.database}`,
  });

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    log("\nNo .sql migrations found.");
    return;
  }

  for (const file of files) {
    log(`\n── ${file} ──`);
    // Strip full-line `--` comments FIRST (the file's header comment documents
    // the {database} and {ttl} tokens, and {ttl} expands to multiple lines), then
    // substitute tokens and split into individual statements.
    const statements = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .replace(/\{database\}/g, config.database)
      .replace(/\{ttl\}/g, ttlClause)
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await client.command({ query: statement });
    }
    log(`  applied ${statements.length} statement(s).`);
  }

  log(`\nDone — ${files.length} migration file(s) applied.`);
}

main()
  .catch((err) => {
    log(`\nERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeLakeClient());
