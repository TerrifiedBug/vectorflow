#!/bin/sh
set -e

if [ "${VF_RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Running database migrations..."
  prisma migrate deploy
else
  echo "Skipping database migrations because VF_RUN_MIGRATIONS=${VF_RUN_MIGRATIONS}"
fi

echo "Starting VectorFlow..."
exec node server.js
