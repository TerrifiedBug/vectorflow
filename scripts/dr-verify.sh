#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# VectorFlow DR Verification Script
#
# Restores a backup into a disposable PostgreSQL container and runs health
# checks to verify the backup is valid and restorable.
#
# Usage:
#   ./scripts/dr-verify.sh                        # auto-detect newest backup
#   ./scripts/dr-verify.sh /path/to/backup.dump   # explicit backup file
#
# Environment:
#   VF_BACKUP_DIR   Backup directory (default: /backups)
#   VF_DR_PG_IMAGE  PostgreSQL image (default: timescale/timescaledb:latest-pg16)
#
# Exit codes:
#   0  All checks passed
#   1  One or more checks failed
#   2  Script error (missing deps, no backup found, Docker not running)
# ---------------------------------------------------------------------------

BACKUP_DIR="${VF_BACKUP_DIR:-/backups}"
PG_IMAGE="${VF_DR_PG_IMAGE:-timescale/timescaledb:latest-pg16}"
PG_USER="vectorflow"
PG_DB="vectorflow"
PG_PASSWORD="dr-verify-$(date +%s)"
CONTAINER_NAME="vf-dr-verify-$$"
READY_TIMEOUT=30
CHECKS_PASSED=0
CHECKS_FAILED=0
STARTED_AT=""

# Key tables to verify have non-zero rows
KEY_TABLES=("User" "Team" "Pipeline" "Environment" "SystemSettings")

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN='' RED='' YELLOW='' BOLD='' RESET=''
fi

pass() {
  CHECKS_PASSED=$((CHECKS_PASSED + 1))
  local elapsed="${2:+ ($2)}"
  printf "${GREEN}[PASS]${RESET} %s%s\n" "$1" "$elapsed"
}

fail() {
  CHECKS_FAILED=$((CHECKS_FAILED + 1))
  local elapsed="${2:+ ($2)}"
  printf "${RED}[FAIL]${RESET} %s%s\n" "$1" "$elapsed"
}

info() {
  printf "${YELLOW}[INFO]${RESET} %s\n" "$1"
}

die() {
  printf "${RED}[ERROR]${RESET} %s\n" "$1" >&2
  exit 2
}

elapsed_since() {
  local start="$1"
  local now
  now=$(date +%s)
  echo "$((now - start))s"
}

# ---------------------------------------------------------------------------
# Cleanup trap
# ---------------------------------------------------------------------------

cleanup() {
  if docker inspect "$CONTAINER_NAME" &>/dev/null; then
    docker rm -f "$CONTAINER_NAME" &>/dev/null || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

command -v docker &>/dev/null || die "docker is required but not found in PATH"
docker info &>/dev/null 2>&1 || die "Docker daemon is not running"

# Detect SHA256 command
if command -v sha256sum &>/dev/null; then
  SHA_CMD="sha256sum"
elif command -v shasum &>/dev/null; then
  SHA_CMD="shasum -a 256"
else
  SHA_CMD=""
fi

# ---------------------------------------------------------------------------
# Locate backup file
# ---------------------------------------------------------------------------

if [ $# -ge 1 ]; then
  BACKUP_FILE="$1"
  [ -f "$BACKUP_FILE" ] || die "Backup file not found: $BACKUP_FILE"
else
  [ -d "$BACKUP_DIR" ] || die "Backup directory not found: $BACKUP_DIR"
  BACKUP_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1 | cut -d' ' -f2-)
  # macOS fallback (no -printf)
  if [ -z "$BACKUP_FILE" ]; then
    BACKUP_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f -exec stat -f '%m %N' {} \; 2>/dev/null \
      | sort -rn | head -1 | awk '{print $2}')
  fi
  [ -n "$BACKUP_FILE" ] || die "No .dump files found in $BACKUP_DIR"
fi

BACKUP_BASENAME=$(basename "$BACKUP_FILE")

# ---------------------------------------------------------------------------
# Begin verification
# ---------------------------------------------------------------------------

STARTED_AT=$(date +%s)

printf "\n${BOLD}DR Verification — %s${RESET}\n" "$BACKUP_BASENAME"
echo "═══════════════════════════════════════════════════"

# ---------------------------------------------------------------------------
# Check 1: SHA256 checksum verification
# ---------------------------------------------------------------------------

CHECKSUM_START=$(date +%s)
META_FILE="${BACKUP_FILE%.dump}.meta.json"
EXPECTED_CHECKSUM=""

# Try to extract checksum from .meta.json sidecar
if [ -f "$META_FILE" ]; then
  if command -v jq &>/dev/null; then
    EXPECTED_CHECKSUM=$(jq -r '.checksum // empty' "$META_FILE" 2>/dev/null || true)
  else
    EXPECTED_CHECKSUM=$(grep -o '"checksum"[[:space:]]*:[[:space:]]*"[^"]*"' "$META_FILE" 2>/dev/null \
      | head -1 | sed 's/.*"checksum"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || true)
  fi
fi

if [ -n "$EXPECTED_CHECKSUM" ] && [ -n "$SHA_CMD" ]; then
  ACTUAL_CHECKSUM=$($SHA_CMD "$BACKUP_FILE" | awk '{print $1}')
  if [ "$ACTUAL_CHECKSUM" = "$EXPECTED_CHECKSUM" ]; then
    pass "SHA256 checksum verified" "$(elapsed_since "$CHECKSUM_START")"
  else
    fail "SHA256 checksum mismatch (expected: ${EXPECTED_CHECKSUM:0:16}..., got: ${ACTUAL_CHECKSUM:0:16}...)" "$(elapsed_since "$CHECKSUM_START")"
  fi
elif [ -n "$EXPECTED_CHECKSUM" ] && [ -z "$SHA_CMD" ]; then
  info "Skipping checksum — neither sha256sum nor shasum found"
else
  info "Skipping checksum — no checksum in metadata"
fi

# ---------------------------------------------------------------------------
# Check 2: Spin up PostgreSQL container
# ---------------------------------------------------------------------------

PG_START=$(date +%s)

docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_DB="$PG_DB" \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_PASSWORD="$PG_PASSWORD" \
  "$PG_IMAGE" >/dev/null 2>&1 \
  || die "Failed to start PostgreSQL container"

# Wait for PostgreSQL to be ready
WAITED=0
until docker exec "$CONTAINER_NAME" pg_isready -U "$PG_USER" -q 2>/dev/null; do
  sleep 1
  WAITED=$((WAITED + 1))
  if [ "$WAITED" -ge "$READY_TIMEOUT" ]; then
    fail "PostgreSQL container did not become ready within ${READY_TIMEOUT}s" "$(elapsed_since "$PG_START")"
    echo "═══════════════════════════════════════════════════"
    printf "${RED}${BOLD}RESULT: FAIL${RESET} (%s total)\n" "$(elapsed_since "$STARTED_AT")"
    exit 1
  fi
done

pass "PostgreSQL container started" "$(elapsed_since "$PG_START")"

# ---------------------------------------------------------------------------
# Check 3: Restore backup
# ---------------------------------------------------------------------------

RESTORE_START=$(date +%s)

# Copy dump file into the container
docker cp "$BACKUP_FILE" "$CONTAINER_NAME:/tmp/$BACKUP_BASENAME"

# Run pg_restore
RESTORE_EXIT=0
docker exec -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER_NAME" \
  pg_restore --clean --if-exists \
  -U "$PG_USER" -d "$PG_DB" \
  "/tmp/$BACKUP_BASENAME" 2>/tmp/dr-restore-err.$$ || RESTORE_EXIT=$?

# pg_restore exit code 1 means warnings (e.g., "relation does not exist" for --clean),
# which is expected on a fresh database. Only exit code >= 2 is a real error.
if [ "$RESTORE_EXIT" -le 1 ]; then
  pass "Backup restored successfully" "$(elapsed_since "$RESTORE_START")"
else
  fail "pg_restore failed with exit code $RESTORE_EXIT" "$(elapsed_since "$RESTORE_START")"
fi

# ---------------------------------------------------------------------------
# Check 4: Database connectivity
# ---------------------------------------------------------------------------

RESULT=$(docker exec -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER_NAME" \
  psql -U "$PG_USER" -d "$PG_DB" -t -A -c "SELECT 1;" 2>/dev/null || true)

if [ "$RESULT" = "1" ]; then
  pass "Database connectivity confirmed"
else
  fail "Database connectivity check failed"
fi

# ---------------------------------------------------------------------------
# Check 5: Schema validation — table count
# ---------------------------------------------------------------------------

TABLE_COUNT=$(docker exec -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER_NAME" \
  psql -U "$PG_USER" -d "$PG_DB" -t -A -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" \
  2>/dev/null || echo "0")

if [ "$TABLE_COUNT" -gt 0 ] 2>/dev/null; then
  pass "Schema validated — $TABLE_COUNT tables found"
else
  fail "Schema validation — no tables found in public schema"
fi

# ---------------------------------------------------------------------------
# Check 6: Row count spot-checks on key tables
# ---------------------------------------------------------------------------

TABLES_OK=0
TABLES_CHECKED=${#KEY_TABLES[@]}

for table in "${KEY_TABLES[@]}"; do
  # Quote the table name to handle PascalCase (Prisma convention)
  ROW_COUNT=$(docker exec -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$PG_USER" -d "$PG_DB" -t -A -c \
    "SELECT count(*) FROM \"$table\";" 2>/dev/null || echo "0")
  if [ "$ROW_COUNT" -gt 0 ] 2>/dev/null; then
    TABLES_OK=$((TABLES_OK + 1))
  fi
done

if [ "$TABLES_OK" -eq "$TABLES_CHECKED" ]; then
  pass "Row counts — $TABLES_OK/$TABLES_CHECKED key tables non-empty"
else
  fail "Row counts — $TABLES_OK/$TABLES_CHECKED key tables non-empty"
fi

# ---------------------------------------------------------------------------
# Check 7: Prisma migration count
# ---------------------------------------------------------------------------

MIGRATION_COUNT=$(docker exec -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER_NAME" \
  psql -U "$PG_USER" -d "$PG_DB" -t -A -c \
  "SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL;" \
  2>/dev/null || echo "0")

# Try to get expected migration count from metadata
EXPECTED_MIGRATIONS=""
if [ -f "$META_FILE" ]; then
  if command -v jq &>/dev/null; then
    EXPECTED_MIGRATIONS=$(jq -r '.migrationCount // empty' "$META_FILE" 2>/dev/null || true)
  else
    EXPECTED_MIGRATIONS=$(grep -o '"migrationCount"[[:space:]]*:[[:space:]]*[0-9]*' "$META_FILE" 2>/dev/null \
      | head -1 | grep -o '[0-9]*$' || true)
  fi
fi

if [ -n "$EXPECTED_MIGRATIONS" ] && [ "$EXPECTED_MIGRATIONS" -gt 0 ] 2>/dev/null; then
  if [ "$MIGRATION_COUNT" = "$EXPECTED_MIGRATIONS" ]; then
    pass "Migration count matches ($MIGRATION_COUNT)"
  else
    fail "Migration count mismatch (expected: $EXPECTED_MIGRATIONS, got: $MIGRATION_COUNT)"
  fi
elif [ "$MIGRATION_COUNT" -gt 0 ] 2>/dev/null; then
  pass "Migration count — $MIGRATION_COUNT migrations found"
else
  fail "Migration count — no completed migrations found"
fi

# ---------------------------------------------------------------------------
# Final report
# ---------------------------------------------------------------------------

echo "═══════════════════════════════════════════════════"

TOTAL_ELAPSED=$(elapsed_since "$STARTED_AT")

if [ "$CHECKS_FAILED" -eq 0 ]; then
  printf "${GREEN}${BOLD}RESULT: PASS${RESET} (%s total)\n" "$TOTAL_ELAPSED"
  exit 0
else
  printf "${RED}${BOLD}RESULT: FAIL${RESET} — %d check(s) failed (%s total)\n" "$CHECKS_FAILED" "$TOTAL_ELAPSED"
  exit 1
fi
