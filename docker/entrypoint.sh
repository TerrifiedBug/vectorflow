#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting VectorFlow..."
exec su-exec vectorflow node server.js
