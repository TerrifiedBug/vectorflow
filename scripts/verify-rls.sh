#!/usr/bin/env bash
# verify-rls.sh — assert that RLS is enabled and at least one policy is
# installed on every tenant table (any public table with an `organizationId`
# column).
#
# Drift-resistant: the table set is enumerated from the live schema rather
# than a hardcoded list, so a newly-added tenant table without policies
# fails the check on the first CI run instead of silently passing.
#
# Usage:
#   DATABASE_URL=postgres://vectorflow_app:...@host/db \
#     ./scripts/verify-rls.sh
#
# Exit status:
#   0 — all checks pass
#   1 — at least one tenant table is missing RLS or a policy

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-rls: DATABASE_URL must be set"
  exit 1
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA)

# Discover every public table that has an `organizationId` column. These
# are the tenant tables that MUST be RLS-protected.
mapfile -t TABLES < <(
  "${PSQL[@]}" -c "
    SELECT c.table_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'organizationId'
     ORDER BY c.table_name;
  "
)

if [[ ${#TABLES[@]} -eq 0 ]]; then
  echo "verify-rls: no tenant tables found — schema not migrated?"
  exit 1
fi

echo "verify-rls: checking ${#TABLES[@]} tenant tables"

fail=0
for tbl in "${TABLES[@]}"; do
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
sample_tables=("${TABLES[@]:0:3}")
for tbl in "${sample_tables[@]}"; do
  cnt=$("${PSQL[@]}" -c "SELECT count(*) FROM \"$tbl\";")
  if [[ "$cnt" -ne 0 ]]; then
    echo "NOTE: $tbl returned $cnt rows without app.org_id (role bypasses RLS — not a strict-mode deployment)"
  else
    echo "OK:   $tbl returned 0 rows without app.org_id (strict mode)"
  fi
done

exit "$fail"
