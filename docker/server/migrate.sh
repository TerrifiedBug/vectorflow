#!/bin/sh
set -e

# One-shot database migration entrypoint, used by the Helm pre-upgrade Job so
# that `prisma migrate deploy` runs exactly once per release instead of racing
# across every server replica. Resolves DATABASE_URL the same way the server
# entrypoint does, applies pending migrations, then exits (it does NOT start
# the server).
SCRIPT_DIR=$(unset CDPATH; cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=docker/server/db-url.sh
. "${SCRIPT_DIR}/db-url.sh"
resolve_database_url

echo "Running database migrations..."
prisma migrate deploy
echo "Migrations complete."
