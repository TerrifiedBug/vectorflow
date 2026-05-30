#!/bin/sh
set -e

# Resolve DATABASE_URL (builds + URL-encodes it from POSTGRES_* when not set).
# The helper lives next to this script so it resolves regardless of cwd.
SCRIPT_DIR=$(unset CDPATH; cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=docker/server/db-url.sh
. "${SCRIPT_DIR}/db-url.sh"
resolve_database_url

# Gate migrations to a single execution. In HA deployments every replica boots
# this entrypoint; running `prisma migrate deploy` from each pod concurrently
# races on the _prisma_migrations advisory lock and can leave a migration half
# applied. The Helm chart runs migrations once via a pre-upgrade Job and sets
# VF_SKIP_MIGRATIONS=true on the server pods so they never migrate themselves.
# Single-instance deployments (docker compose, the default chart with one
# replica) leave it unset and keep migrating inline on boot.
if [ "${VF_SKIP_MIGRATIONS:-false}" = "true" ]; then
    echo "Skipping database migrations (VF_SKIP_MIGRATIONS=true)."
else
    echo "Running database migrations..."
    prisma migrate deploy
fi

echo "Starting VectorFlow..."
exec node server.js
