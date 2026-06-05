/**
 * VectorFlow Lake — ClickHouse migration CLI (A1).
 *
 * Thin wrapper over `runLakeMigrations()` (src/server/services/lake/migrate.ts),
 * which holds the actual logic so the cloud managed-lake bootstrap can reuse it.
 *
 * NO-OP when disabled: if VF_LAKE_CLICKHOUSE_URL is unset it prints a message and
 * exits 0 without connecting — safe to wire into a boot/migrate step on non-lake
 * deployments.
 *
 * Usage:
 *   pnpm tsx scripts/lake-migrate.ts
 */

import { runLakeMigrations } from "../src/server/services/lake/migrate";
import { closeLakeClient } from "../src/server/services/lake/clickhouse";

runLakeMigrations()
  .then((result) => {
    if (result.skipped) {
      process.stdout.write(
        "VectorFlow Lake is disabled (VF_LAKE_CLICKHOUSE_URL unset) — nothing to migrate.\n",
      );
      return;
    }
    process.stdout.write(
      `VectorFlow Lake: applied ${result.files} migration file(s), ${result.statements} statement(s).\n`,
    );
  })
  .catch((err: unknown) => {
    process.stdout.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeLakeClient());
