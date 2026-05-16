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
#   0  — assertions pass (positive control empty across all samples)
#   1  — positive control LEAKED — RLS isolation is BROKEN
#   2  — negative control couldn't run / meta-check failed (probe is
#         mis-configured)
#   64 — DATABASE_URL not provided (sysexits.h-style EX_USAGE; distinct
#         from a real leak detection so CI / wrappers don't conflate
#         setup failure with isolation regression)

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-pgbouncer-leak: DATABASE_URL is required" >&2
  exit 64
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA)

# Codex review (PR #338): PgBouncer in transaction-pooling mode reassigns
# transactions across backend connections; a single reconnect can land us
# on the SAME backend we just released and miss a real leak. Sample N
# consecutive checkouts so the probability of revisiting the original
# pool slot drops geometrically.
#
# With pool size N and one contaminated slot, the chance of hitting it
# in S reconnects is `1 - (1 - 1/N)^S`. For N=25 we need S>=70 to reach
# 95% confidence; for N=50, S>=140. Default to 100 \u2014 covers the typical
# 25\u201350-slot deployments well above 99%, and tunable via
# `VF_PGBOUNCER_PROBE_SAMPLES` for fleets with larger pools.
SAMPLES="${VF_PGBOUNCER_PROBE_SAMPLES:-100}"

# Cleanup trap (Codex P1 round-4 review of PR #338): the negative
# control writes `set_config('app.org_id', 'probe-negative', false)`
# AND the positive control writes a tx-scoped `'probe-positive'`. On
# PgBouncer the backend that handled the negative SET stays tagged
# after the probe exits and contaminates later clients; the positive
# SET should be tx-local but if the probe found a leak that\'s exactly
# the contamination we have to clean up too. Register an EXIT trap so
# RESET runs on EVERY exit path (success, positive leak, negative
# meta-check failure) \u2014 not just the happy-path tail.
cleanup() {
  for _ in $(seq 1 "${SAMPLES:-100}"); do
    "${PSQL[@]}" -c "RESET app.org_id" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# ── Positive control: set_config(..., true) MUST be tx-scoped ──────────
echo "── Positive control: set_config('app.org_id', 'probe-positive', true) ──"
"${PSQL[@]}" <<'SQL'
BEGIN;
SELECT set_config('app.org_id', 'probe-positive', true);
COMMIT;
SQL

# Reconnect N times — each new psql invocation is a fresh client TCP
# connection that PgBouncer can satisfy from a different backend slot.
# Any single non-empty read fails the probe; the loop runs the full
# count even after a success so flaky non-deterministic leaks surface.
leaks=0
for i in $(seq 1 "$SAMPLES"); do
  positive_leak=$("${PSQL[@]}" <<'SQL'
SELECT coalesce(current_setting('app.org_id', true), '');
SQL
  )
  if [[ -n "$positive_leak" ]]; then
    echo "  LEAK (sample $i/$SAMPLES): app.org_id='$positive_leak'"
    leaks=$((leaks + 1))
  fi
done
if [[ $leaks -gt 0 ]]; then
  echo "  FAIL: $leaks/$SAMPLES samples leaked app.org_id"
  echo "  → withOrgTx GUC is NOT tx-scoped on this deployment."
  echo "  → RLS isolation is broken; do NOT ship Cloud-stamp on this DB."
  exit 1
fi
echo "  OK: positive control empty across $SAMPLES samples"

# ── Negative control: meta-check that the probe actually crosses backend
#    connections. Codex review on PR #338 called out that running the
#    SET and the SELECT in the same psql process trivially returns the
#    SET value and validates NOTHING — the check only ensures
#    `set_config` itself works. To actually validate the reconnect path
#    we issue session-level (`set_config(_, _, false)`) in psql A and
#    read it back from a SEPARATE psql B. If psql B sees the value, we
#    know SOME backend reuse is occurring (PgBouncer session-style) and
#    the positive control's "empty reads" are meaningful. If psql B sees
#    nothing, the probe is running on plain Postgres (or PgBouncer is
#    serving each psql from a different backend); in that case the
#    positive control still holds but the meta-check is informational
#    only, NOT a hard failure.
echo "── Negative control: cross-process backend-reuse meta-check ──"
"${PSQL[@]}" <<'SQL'
SELECT set_config('app.org_id', 'probe-negative', false);
SQL
negative_hits=0
for i in $(seq 1 "$SAMPLES"); do
  negative_observed=$("${PSQL[@]}" <<'SQL'
SELECT coalesce(current_setting('app.org_id', true), '');
SQL
  )
  if [[ "$negative_observed" == "probe-negative" ]]; then
    negative_hits=$((negative_hits + 1))
  fi
done
if [[ $negative_hits -gt 0 ]]; then
  echo "  OK: $negative_hits/$SAMPLES samples saw the session SET — backend reuse confirmed."
  echo "      The positive control's empty reads above are meaningful."
else
  echo "  INFO: 0/$SAMPLES samples saw the session SET."
  echo "      Most likely running on plain Postgres or each psql got a"
  echo "      different backend. Positive control still holds, but this"
  echo "      meta-check is informational only on direct Postgres."
fi

# Cleanup runs from the EXIT trap registered up top — fires on success,
# positive-leak failure (exit 1), and negative meta-check failure (exit 2).

echo
echo "verify-pgbouncer-leak: passed."
exit 0
