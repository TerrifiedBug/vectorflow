#!/usr/bin/env bash
# verify-rls.sh — verify Postgres row-level security for tenant isolation.
#
# Two layers:
#   1. Installation (any role): every tenant table (any public BASE TABLE with
#      an `organizationId` column) has RLS enabled AND at least one policy.
#      Drift-resistant — the table set is read from the live schema, so a new
#      tenant table without a policy fails on the first CI run.
#   2. Enforcement (role-aware): whether the policies actually FIRE depends on
#      the connecting role. The OSS table-owner role is BYPASSRLS, so policies
#      never apply (single-tenant default — installation-only). A multi-tenant
#      deployment connects as the NOBYPASSRLS `vectorflow_app` role; on that
#      role this script ASSERTS that an unscoped read (no `app.org_id`) AND a
#      read scoped to a non-existent org BOTH return zero rows. A leak there
#      means RLS is not actually blocking cross-tenant reads — hard failure.
#
# TimescaleDB carve-out: hypertables with columnstore (compression) enabled
# cannot have RLS at the parent level (timescale/timescaledb#6827) and parent
# policies don't propagate to chunks (#7830). The RLS migration
# (20260516000001) skips them and relies on app-layer isolation via
# `withOrgTx`; this script applies the same skip.
#
# Usage:
#   # installation check as the table owner (OSS default):
#   DATABASE_URL=postgres://vectorflow:...@host/db ./scripts/verify-rls.sh
#   # full enforcement assertion as the fenced app role (multi-tenant CI):
#   DATABASE_URL=postgres://vectorflow_app:...@host/db ./scripts/verify-rls.sh
#   # optional positive check — a seeded org that MUST be visible:
#   VF_VERIFY_SEEDED_ORG=<orgId> DATABASE_URL=... ./scripts/verify-rls.sh
#
# Exit status:
#   0 — all checks pass (compressed hypertables reported SKIP, not FAIL; a
#       BYPASSRLS role runs installation-only)
#   1 — a tenant table is missing RLS/a policy, OR (on a NOBYPASSRLS role) RLS
#       failed to block an unscoped / wrong-org read

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-rls: DATABASE_URL must be set"
  exit 1
fi

PSQL=(psql -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA)

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

# ── Enforcement probe (role-aware) ─────────────────────────────────────
# Whether the policies actually FIRE depends on the connecting role. A
# BYPASSRLS role (the OSS table owner) sees every row regardless of policy —
# the single-tenant default, so we report installation only. A NOBYPASSRLS
# role (vectorflow_app, multi-tenant) MUST be blocked by the policies; we
# assert it and FAIL on any leak.
echo
role=$("${PSQL[@]}" -c "SELECT current_user;")
bypass=$("${PSQL[@]}" -c "SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;")

# Sample up to 3 RLS-protected base tables (compressed hypertables say nothing
# about RLS state, so skip them).
sample_tables=()
for tbl in "${TABLES[@]}"; do
  if ! is_compressed_hypertable "$tbl"; then
    sample_tables+=("$tbl")
    [[ "${#sample_tables[@]}" -ge 3 ]] && break
  fi
done

if [[ "$bypass" == "t" ]]; then
  echo "── Enforcement probe: role '$role' is BYPASSRLS (owner / single-tenant) ──"
  echo "NOTE: policies do not fire on a BYPASSRLS role — this run verified policy"
  echo "      INSTALLATION only. Connect as the NOBYPASSRLS vectorflow_app role to"
  echo "      assert blocking (scripts/grant-vectorflow-app.sql)."
else
  echo "── Enforcement probe: role '$role' is NOBYPASSRLS — asserting blocking ──"
  # A definitely-nonexistent org id: with RLS filtering organizationId against
  # current_setting('app.org_id', true), no real row can match it.
  bogus_org="__rls_probe_nonexistent_org__"
  for tbl in "${sample_tables[@]}"; do
    unscoped=$("${PSQL[@]}" -c "SELECT count(*) FROM \"$tbl\";")
    if [[ "$unscoped" -ne 0 ]]; then
      echo "FAIL: $tbl returned $unscoped row(s) with no app.org_id set — RLS is NOT blocking unscoped reads"
      fail=1
    else
      echo "OK:   $tbl — 0 rows with no app.org_id (policy blocks unscoped reads)"
    fi
    scoped=$("${PSQL[@]}" <<SQL
SELECT set_config('app.org_id', '$bogus_org', false);
SELECT count(*) FROM "$tbl";
SQL
)
    scoped_count=$(printf '%s\n' "$scoped" | tail -n1)
    if [[ "$scoped_count" -ne 0 ]]; then
      echo "FAIL: $tbl returned $scoped_count row(s) for a non-existent org — RLS is NOT filtering by app.org_id"
      fail=1
    else
      echo "OK:   $tbl — 0 rows for a non-existent org (policy filters by app.org_id)"
    fi
  done

  # Optional positive check: a seeded org passed by CI MUST be visible when set
  # as app.org_id — proves the policy ADMITS the matching tenant (the other half
  # of "blocks others, admits self"). Informational here; CI asserts on it.
  seeded="${VF_VERIFY_SEEDED_ORG:-}"
  if [[ -n "$seeded" ]]; then
    if [[ "$seeded" =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then
      for tbl in "${sample_tables[@]}"; do
        visible=$("${PSQL[@]}" <<SQL
SELECT set_config('app.org_id', '$seeded', false);
SELECT count(*) FROM "$tbl";
SQL
)
        echo "INFO: $tbl visible to seeded org '$seeded': $(printf '%s\n' "$visible" | tail -n1) row(s)"
      done
    else
      echo "WARN: VF_VERIFY_SEEDED_ORG='$seeded' is not a valid org id ([A-Za-z0-9_-]{1,64}); skipping positive check"
    fi
  fi
fi

exit "$fail"
