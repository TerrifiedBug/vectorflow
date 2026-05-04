#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/server/docker-compose.yml"

export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-compose-verify-password}"
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-compose-verify-secret}"
export NEXTAUTH_URL="${NEXTAUTH_URL:-http://localhost:3000}"
export VF_ENROLLMENT_TOKEN="${VF_ENROLLMENT_TOKEN:-compose-verify-token}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

# vf-agent, opensearch, and opensearch-dashboards must not appear in the default profile
base_services="$(docker compose -f "$COMPOSE_FILE" config --services)"
for service in opensearch opensearch-dashboards vf-agent; do
  if grep -qx "$service" <<<"$base_services"; then
    echo "service $service must stay out of the default compose path" >&2
    exit 1
  fi
done

# All VectorFlow stack services must appear under the opensearch profile
profile_services="$(docker compose -f "$COMPOSE_FILE" --profile opensearch config --services)"
for service in postgres vectorflow opensearch opensearch-dashboards vf-agent; do
  if ! grep -qx "$service" <<<"$profile_services"; then
    echo "profile is missing service: $service" >&2
    exit 1
  fi
done

# The raw Vector service must NOT be present — the agent manages Vector internally
if grep -qx "opensearch-demo-pipeline" <<<"$profile_services"; then
  echo "opensearch-demo-pipeline must be removed — vf-agent manages Vector processes internally" >&2
  exit 1
fi

rendered_profile="$(docker compose -f "$COMPOSE_FILE" --profile opensearch config)"
for expected in \
  "OPENSEARCH_JAVA_OPTS: -Xms512m -Xmx512m" \
  'DISABLE_SECURITY_PLUGIN: "true"' \
  'DISABLE_SECURITY_DASHBOARDS_PLUGIN: "true"' \
  "http://opensearch:9200" \
  "VF_URL: http://vectorflow:3000" \
  "ghcr.io/terrifiedbug/vectorflow-agent"; do
  if ! grep -Fq "$expected" <<<"$rendered_profile"; then
    echo "rendered compose profile missing expected value: $expected" >&2
    exit 1
  fi
done

echo "ok: OpenSearch compose profile is valid"
