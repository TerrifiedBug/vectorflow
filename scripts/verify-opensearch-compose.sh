#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/server/docker-compose.yml"
SAMPLE_FILE="$ROOT_DIR/examples/opensearch-demo/vector-demo-opensearch.yaml"

export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-compose-verify-password}"
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-compose-verify-secret}"
export NEXTAUTH_URL="${NEXTAUTH_URL:-http://localhost:3000}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$SAMPLE_FILE" ]]; then
  echo "missing sample pipeline config: $SAMPLE_FILE" >&2
  exit 1
fi

base_services="$(docker compose -f "$COMPOSE_FILE" config --services)"
for service in opensearch opensearch-dashboards opensearch-demo-pipeline; do
  if grep -qx "$service" <<<"$base_services"; then
    echo "service $service must stay out of the default compose path" >&2
    exit 1
  fi
done

profile_services="$(docker compose -f "$COMPOSE_FILE" --profile opensearch config --services)"
for service in postgres vectorflow opensearch opensearch-dashboards opensearch-demo-pipeline; do
  if ! grep -qx "$service" <<<"$profile_services"; then
    echo "profile is missing service: $service" >&2
    exit 1
  fi
done

rendered_profile="$(docker compose -f "$COMPOSE_FILE" --profile opensearch config)"
for expected in \
  "OPENSEARCH_JAVA_OPTS: -Xms512m -Xmx512m" \
  'DISABLE_SECURITY_PLUGIN: "true"' \
  'DISABLE_SECURITY_DASHBOARDS_PLUGIN: "true"' \
  "http://opensearch:9200" \
  "/etc/vector/vector-demo-opensearch.yaml"; do
  if ! grep -Fq "$expected" <<<"$rendered_profile"; then
    echo "rendered compose profile missing expected value: $expected" >&2
    exit 1
  fi
done

for expected in \
  "type: demo_logs" \
  "type: elasticsearch" \
  "http://opensearch:9200" \
  "vectorflow-demo-%Y.%m.%d"; do
  if ! grep -Fq "$expected" "$SAMPLE_FILE"; then
    echo "sample pipeline missing expected value: $expected" >&2
    exit 1
  fi
done
