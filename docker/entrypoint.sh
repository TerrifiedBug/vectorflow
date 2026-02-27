#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting VectorFlow..."
exec node server.js
