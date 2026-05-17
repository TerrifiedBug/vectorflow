#!/usr/bin/env bash
# verify-indexes.sh — assert composite-index coverage on tenant tables.
#
# Plan §3 "Composite index strategy" + §16b OSS item 6.
#
# RLS returns correct results but scans the full table if Postgres has no
# index whose **leading column is `organizationId`**. Every tenant table
# MUST have at least one such index, or the post-RLS hot path becomes a
# Seq Scan over the whole tenant population — which destroys SLO p95s
# the moment a few thousand orgs land on a stamp.
#
# This script:
#
#   1. Enumerates every public BASE TABLE that has an `organizationId`
#      column (drift-resistant — new tenant tables are picked up
#      automatically).
#   2. For each, checks that at least one btree index exists whose
#      first key column is `organizationId`. The check is robust to
#      Prisma's @@index([organizationId, ...]) naming — we read the
#      column order directly from `pg_index.indkey`.
#   3. Reports any missing tables with a structured FAIL line and exits 1.
#
# Why "first column" and not "any column":
#   - Postgres only uses an index to satisfy a leading-column predicate
#     (or skip-scan in PG12+, which doesn't help for RLS's equality
#     filter on `organizationId`). An index like (teamId, organizationId)
#     does NOT serve `WHERE "organizationId" = $1` as an Index Scan.
#   - The check intentionally rejects partial / expression indexes that
#     happen to mention organizationId without leading on it.
#
# Exempt tables:
#   - Tables where the composite index strategy doesn't apply (e.g.
#     append-only logs with extreme write skew where the org filter
#     would be served by a different access path). Listed in
#     EXEMPT_TABLES below with a comment explaining each.
#
# Usage:
#   DATABASE_URL=postgres://vectorflow_app:...@host/db \
#     ./scripts/verify-indexes.sh
#
# Exit status:
#   0 — every tenant table has at least one `(organizationId, ...)`
#       composite btree index (or is on the exempt list)
#   1 — at least one tenant table is missing the required index

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-indexes: DATABASE_URL must be set"
  exit 1
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA)

# Tables intentionally excluded — keep this list tiny and document why.
# The check still PASSES against an exempt table, but we log a note so
# the exemption is visible in CI output.
EXEMPT_TABLES=()

# Enumerate every public BASE TABLE that has an `organizationId` column.
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

# Guard: if no tables were discovered, the DATABASE_URL likely points at the
# wrong database or migrations haven't run yet. Fail loudly rather than
# exiting 0 with an empty summary that looks like a clean run.
if [[ ${#TABLES[@]} -eq 0 ]]; then
  echo "verify-indexes: ERROR — no tenant tables with organizationId found."
  echo "Check DATABASE_URL and that all migrations have been applied."
  exit 1
fi

# TimescaleDB hypertable carve-out: the parent table's indexes are
# replicated to chunks automatically, so the check on the parent table
# is sufficient. The script does NOT skip hypertables — they MUST have
# the composite index for chunk-level Index Scan to work.

failures=0
checked=0
total="${#TABLES[@]}"

is_exempt() {
  local t="$1"
  for e in "${EXEMPT_TABLES[@]}"; do
    if [[ "$e" == "$t" ]]; then
      return 0
    fi
  done
  return 1
}

# For each table, find btree indexes whose first attribute is the
# organizationId column.
for table in "${TABLES[@]}"; do
  if is_exempt "$table"; then
    echo "SKIP  $table (exempt)"
    continue
  fi

  checked=$((checked + 1))

  # SQL explanation:
  #   pg_index.indkey is an int2vector of attribute numbers
  #   (1-based) in key order. We:
  #     - join to pg_class for the index name (diagnostic only),
  #     - join to pg_attribute on (indrelid, indkey[0]) to fetch the
  #       leading column name,
  #     - filter to btree access method (indam.amname = 'btree'),
  #     - filter to a non-partial index (indpred IS NULL) so we don't
  #       count partial indexes that would only serve a sliver of
  #       tenant queries.
  hit=$(
    "${PSQL[@]}" -c "
      SELECT COUNT(*) FROM pg_index i
        JOIN pg_class  c  ON c.oid = i.indexrelid
        JOIN pg_class  t  ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_am     am ON am.oid = c.relam
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid
         AND a.attnum   = i.indkey[0]
       WHERE n.nspname  = 'public'
         AND t.relname  = '$table'
         AND am.amname  = 'btree'
         AND i.indpred IS NULL
         AND a.attname  = 'organizationId';
    "
  )

  if [[ "${hit:-0}" -lt 1 ]]; then
    echo "FAIL  $table  — no btree index whose first column is organizationId"
    failures=$((failures + 1))
  else
    echo "OK    $table  ($hit composite index(es) leading on organizationId)"
  fi
done

echo
echo "verify-indexes: $checked of $total tenant tables checked, $failures failure(s)"

if [[ "$failures" -gt 0 ]]; then
  cat <<MSG
verify-indexes: at least one tenant table is missing a composite
\`(organizationId, ...)\` btree index. Without one, Postgres falls back
to a Seq Scan for the RLS predicate and the p95 SLO from §12.5 cannot
be held. Add the index in a Prisma migration:

  @@index([organizationId, <next-most-selective-column>])

and re-run this script. If the table really should be exempt, add it
to EXEMPT_TABLES at the top of this script with a comment justifying
why.
MSG
  exit 1
fi

echo "verify-indexes: all tenant tables have the required leading-organizationId index"
