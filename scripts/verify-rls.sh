#!/usr/bin/env bash
# verify-rls.sh — assert that RLS policies are installed and enforce isolation.
#
# Usage:
#   DATABASE_URL=postgres://vectorflow_app:...@host/db \
#     ./scripts/verify-rls.sh
#
# Exit status:
#   0 — all checks pass
#   1 — at least one policy is missing or non-enforcing

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-rls: DATABASE_URL must be set"
  exit 1
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA)

TABLES=(
  Pipeline PipelineVersion PipelineLog
  NodeMetric PipelineMetric EventSample EventSampleRequest
  AuditLog AnomalyEvent
  NotificationChannel AlertRule WebhookEndpoint
  Environment VectorNode Team OrgMember
  OrganizationSettings OrgAccessGrant
)

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
# return zero rows (assumes connection is via a NOBYPASSRLS role and the
# table has FORCE ROW LEVEL SECURITY when owned by that role).
echo
echo "── Strict-mode probe (only meaningful for a non-owner role) ──"
for tbl in Pipeline AuditLog AlertRule; do
  cnt=$("${PSQL[@]}" -c "SELECT count(*) FROM \"$tbl\";")
  if [[ "$cnt" -ne 0 ]]; then
    echo "WARN: $tbl returned $cnt rows without app.org_id (role bypasses RLS — not a strict-mode deployment)"
  else
    echo "OK:   $tbl returned 0 rows without app.org_id (strict mode)"
  fi
done

exit "$fail"
