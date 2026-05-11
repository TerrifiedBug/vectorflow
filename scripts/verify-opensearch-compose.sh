#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_FILE="$ROOT_DIR/docker/server/docker-compose.yml"
OS_FILE="$ROOT_DIR/docker/server/docker-compose.opensearch.yml"

export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-compose-verify-password}"
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-compose-verify-secret}"
export NEXTAUTH_URL="${NEXTAUTH_URL:-http://localhost:3000}"
export VF_ENROLLMENT_TOKEN="${VF_ENROLLMENT_TOKEN:-compose-verify-token}"

for f in "$CORE_FILE" "$OS_FILE"; do
  if [[ ! -f "$f" ]]; then
    echo "FAIL: compose file not found: $f" >&2
    exit 1
  fi
done

# ── Core compose (docker-compose.yml) ────────────────────────
# Must contain postgres, vectorflow, and vf-agent — no opensearch services.
core_services="$(docker compose -f "$CORE_FILE" config --services)"
for service in postgres vectorflow vf-agent; do
  if ! grep -qx "$service" <<<"$core_services"; then
    echo "FAIL: core compose is missing service: $service" >&2
    exit 1
  fi
done
for service in opensearch opensearch-dashboards; do
  if grep -qx "$service" <<<"$core_services"; then
    echo "FAIL: core compose must not contain $service" >&2
    exit 1
  fi
done

# ── OpenSearch compose (docker-compose.opensearch.yml) ───────
# Must contain all five services.
os_services="$(docker compose -f "$OS_FILE" config --services)"
for service in postgres vectorflow opensearch opensearch-dashboards vf-agent; do
  if ! grep -qx "$service" <<<"$os_services"; then
    echo "FAIL: opensearch compose is missing service: $service" >&2
    exit 1
  fi
done

# Verify key environment values are rendered correctly.
rendered_os="$(docker compose -f "$OS_FILE" config)"
for expected in \
  "OPENSEARCH_JAVA_OPTS: -Xms512m -Xmx512m" \
  'DISABLE_SECURITY_PLUGIN: "true"' \
  'DISABLE_SECURITY_DASHBOARDS_PLUGIN: "true"' \
  "http://opensearch:9200" \
  "VF_URL: http://vectorflow:3000" \
  "ghcr.io/terrifiedbug/vectorflow-agent"; do
  if ! grep -qF "$expected" <<<"$rendered_os"; then
    echo "FAIL: opensearch compose config missing expected value: $expected" >&2
    exit 1
  fi
done

# The raw Vector service must NOT be present — the agent manages Vector internally.
if grep -qx "opensearch-demo-pipeline" <<<"$os_services"; then
  echo "FAIL: opensearch compose must not define a raw 'opensearch-demo-pipeline' service" >&2
  exit 1
fi

echo "ok: both compose files are valid"
