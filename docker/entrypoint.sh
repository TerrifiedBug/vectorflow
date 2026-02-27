#!/bin/sh
set -e

echo "Running database migrations..."
NODE_PATH=/app/node_modules_prisma node /app/node_modules_prisma/prisma/build/index.js migrate deploy

echo "Starting VectorFlow..."
exec node server.js
