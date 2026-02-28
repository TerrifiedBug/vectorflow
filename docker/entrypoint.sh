#!/bin/sh
set -e

# Fix ownership on mounted volumes (runs as root)
if [ -n "$VECTOR_CONFIG_DIR" ] && [ -d "$VECTOR_CONFIG_DIR" ]; then
  chown vectorflow:nodejs "$VECTOR_CONFIG_DIR"
fi

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting VectorFlow..."
exec su-exec vectorflow node server.js
