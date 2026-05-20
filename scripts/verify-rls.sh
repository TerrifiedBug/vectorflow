#!/usr/bin/env bash
# verify-rls.sh — assert that RLS is enabled and at least one policy is
# installed on every tenant table (any public table with an `organizationId`
# column).
#
# Drift-resistant: the table set is enumerated from the live schema rather
# than a hardcoded list, so a newly-added tenant table without policies
# fails the check on the first CI run instead of silently passing.
#
# TimescaleDB carve-out: hypertables with columnstore (compression) enabled
# cannot have RLS enabled at the parent level (timescale/timescaledb#6827),
# and parent-table policies do not propagate to chunks anyway
# (timescale/timescaledb#7830). The RLS migration (20260516000001) skips
# those tables and relies on application-layer isolation via `withOrgTx` +
# the composite `(organizationId, …)` indexes. This script applies the same
# skip so it doesn't fail spuriously on TimescaleDB hosts.
#
# Usage:
#   DATABASE_URL=postgres://vectorflow_app:...@host/db \
#     ./scripts/verify-rls.sh
#
# Exit status:
#   0 — all checks pass (compressed hypertables reported as SKIP, not FAIL)
#   1 — at least one non-exempt tenant table is missing RLS or a policy

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-rls: DATABASE_URL must be set"
  exit 1
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA)

# Discover every public BASE TABLE that has an `organizationId` column.
# Views (e.g. the operator PII views from migration 20260516000007) are
# excluded — RLS lives on the underlying tables, not the views.
mapfile -t TABLES < <(
  "${PSQL[@]}" -c "
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name   = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'organizationId'
       AND t.table_type   = 'BASE TABLE'
     ORDER BY c.table_name;
  "
)

# Feature-detect TimescaleDB and enumerate hypertables with columnstore
# enabled. Those are excluded from the RLS check below; see header comment
# for rationale.
has_timescaledb=$("${PSQL[@]}" -c "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb');")
if [[ "$has_timescaledb" == "t" ]]; then
  mapfile -t COMPRESSED_HYPERTABLES < <(
    "${PSQL[@]}" -c "
      SELECT hypertable_name
        FROM timescaledb_information.hypertables
       WHERE hypertable_schema = 'public'
         AND compression_enabled = true
       ORDER BY hypertable_name;
    "
  )
else
  COMPRESSED_HYPERTABLES=()
fi

is_compressed_hypertable() {
  local target="$1"
  local h
  for h in "${COMPRESSED_HYPERTABLES[@]}"; do
    [[ "$h" == "$target" ]] && return 0
  done
  return 1
}

if [[ ${#TABLES[@]} -eq 0 ]]; then
  echo "verify-rls: no tenant tables found — schema not migrated?"
  exit 1
fi

echo "verify-rls: checking ${#TABLES[@]} tenant tables (${#COMPRESSED_HYPERTABLES[@]} compressed hypertable(s) exempt)"

fail=0
for tbl in "${TABLES[@]}"; do
  if is_compressed_hypertable "$tbl"; then
    echo "SKIP: $tbl — TimescaleDB compressed hypertable (isolation via withOrgTx; see migration 20260516000001 §3)"
    continue
  fi

  rls=$("${PSQL[@]}" -c "SELECT relrowsecurity FROM pg_class WHERE relname = '$tbl' AND relkind = 'r';")
  if [[ "$rls" != "t" ]]; then
    echo "FAIL: $tbl does not have ROW LEVEL SECURITY enabled"
    fail=1
    continue
  fi
  policy=$("${PSQL[@]}" -c "SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = '$tbl';")
  if [[ "$policy" -lt 1 ]]; then
    echo "FAIL: $tbl has RLS enabled but no policy installed"
    fail=1
    continue
  fi
  echo "OK:   $tbl — RLS=on, policies=$policy"
done

# Strict-mode assertion: when app.org_id is unset, tenant tables MUST
# return zero rows. Only meaningful for a connection via a non-owner role
# (the OSS table-owner role bypasses RLS by default and will return rows
# here — that's expected and not a failure).
echo
echo "── Strict-mode probe (only meaningful for a non-owner role) ──"
# Sample up to 3 RLS-protected tables, skipping the compressed-hypertable
# carve-outs (their `count(*)` says nothing about RLS state).
sample_tables=()
for tbl in "${TABLES[@]}"; do
  if ! is_compressed_hypertable "$tbl"; then
    sample_tables+=("$tbl")
    [[ "${#sample_tables[@]}" -ge 3 ]] && break
  fi
done
for tbl in "${sample_tables[@]}"; do
  cnt=$("${PSQL[@]}" -c "SELECT count(*) FROM \"$tbl\";")
  if [[ "$cnt" -ne 0 ]]; then
    echo "NOTE: $tbl returned $cnt rows without app.org_id (role bypasses RLS — not a strict-mode deployment)"
  else
    echo "OK:   $tbl returned 0 rows without app.org_id (strict mode)"
  fi
done

exit "$fail"
