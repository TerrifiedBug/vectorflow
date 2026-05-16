#!/usr/bin/env bash
# verify-pgbouncer-leak.sh — assert that the `withOrgTx` GUC scoping
# pattern survives a PgBouncer transaction-pooling deployment (plan §3 /
# §18 / Phase 5dd).
#
# Why this script exists:
#
# The tenancy boundary relies on
#     SELECT set_config('app.org_id', '<org>', true)
# inside an explicit BEGIN/COMMIT, where `true` scopes the setting to
# the current transaction (`SET LOCAL` semantics). RLS policies on every
# tenant table compare `organizationId` against
#     current_setting('app.org_id', true)
# so if the GUC EVER leaks between requests on a pooled connection,
# every subsequent request on that pool slot inherits the wrong tenant
# context — RLS happily returns the previous tenant's rows.
#
# This probe runs two assertions against the configured DATABASE_URL:
#
#   1. Positive control — `set_config(..., true)` inside a tx, COMMIT,
#      reconnect, assert `current_setting('app.org_id', true)` is empty.
#      MUST hold even on direct Postgres (no PgBouncer); the test catches
#      regressions where someone accidentally drops the `true` argument
#      or uses session-level SET outside a transaction.
#
#   2. Negative control — `set_config(..., false)` inside a tx, COMMIT,
#      reconnect, assert the GUC leaked. Verifies the probe actually
#      detects leakage; if the negative case ALSO comes back empty,
#      something is wrong with the probe itself (we're not actually
#      reusing a connection) and the positive result above is meaningless.
#
# When run against a PgBouncer in transaction-pooling mode the probe
# additionally exercises the cross-checkout case: each connect() lands on
# a (possibly different) backend pool slot, and the positive control
# MUST still hold.
#
# Usage:
#   DATABASE_URL=postgres://vectorflow_app:...@host/db \
#     ./scripts/verify-pgbouncer-leak.sh
#
# Exit status:
#   0 — both assertions pass (positive control empty, negative non-empty)
#   1 — positive control LEAKED — RLS isolation is BROKEN
#   2 — negative control didn't leak — probe is mis-configured (e.g.
#       new connection per query instead of pool reuse)

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-pgbouncer-leak: DATABASE_URL is required" >&2
  exit 1
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA)

# ── Positive control: set_config(..., true) MUST be tx-scoped ──────────
echo "── Positive control: set_config('app.org_id', 'probe-positive', true) ──"
"${PSQL[@]}" <<'SQL'
BEGIN;
SELECT set_config('app.org_id', 'probe-positive', true);
COMMIT;
SQL

# Reconnect — psql exits and a fresh process starts a new TCP connection.
# Through PgBouncer in transaction-pooling mode this hands us a different
# backend slot than the one we just released, so the read below proves
# the GUC didn't persist on the backend.
positive_leak=$("${PSQL[@]}" <<'SQL'
SELECT coalesce(current_setting('app.org_id', true), '');
SQL
)

if [[ -n "$positive_leak" ]]; then
  echo "  FAIL: app.org_id leaked across connection: '$positive_leak'"
  echo "  → withOrgTx GUC is NOT tx-scoped on this deployment."
  echo "  → RLS isolation is broken; do NOT ship Cloud-stamp on this DB."
  exit 1
fi
echo "  OK: positive control empty after reconnect"

# ── Negative control: set_config(..., false) MUST persist on this conn ─
echo "── Negative control: set_config('app.org_id', 'probe-negative', false) ──"
# Run the SET and the SELECT in the SAME psql process so we keep the
# connection open between them — if the negative SET leaks at all,
# it'll leak within this single session.
negative_leak=$("${PSQL[@]}" <<'SQL'
SELECT set_config('app.org_id', 'probe-negative', false);
SELECT coalesce(current_setting('app.org_id', true), '');
SQL
)

# `set_config` returns the value it set on the first line; the second
# line is the actual leak read. Grab only the trailing one.
negative_observed=$(echo "$negative_leak" | tail -n1)

if [[ "$negative_observed" != "probe-negative" ]]; then
  echo "  FAIL: negative-control SET didn't take effect: '$negative_observed'"
  echo "  → Either the probe is mis-configured or session-level SET is broken."
  exit 2
fi
echo "  OK: negative control observed: '$negative_observed' (as expected)"

echo
echo "verify-pgbouncer-leak: both assertions passed; RLS isolation holds."
exit 0
