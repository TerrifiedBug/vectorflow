-- VectorFlow Lake — lake_events (A1)
--
-- The long-retention event store for logs, metrics and traces. One wide table,
-- partitioned by day and ordered by (organizationId, pipelineId, timestamp) so
-- the common "one org's one pipeline over a time window" scan stays a prefix
-- range read. The Postgres `LakeDataset` catalog tracks per-pipeline schema,
-- counts and tiering; the events themselves live here.
--
-- TEMPLATING — this file is processed by scripts/lake-migrate.ts, NOT applied
-- raw. The runner substitutes:
--   {database}  → VF_LAKE_CLICKHOUSE_DATABASE (default "vectorflow_lake")
--   {ttl}       → the retention/tiering clause:
--                   • VF_LAKE_S3_BUCKET SET   → TTL ... TO VOLUME 'cold' (move to
--                     the S3 cold disk after the hot window), then DELETE, plus
--                     `SETTINGS storage_policy = 'vf_hot_cold'`.
--                   • VF_LAKE_S3_BUCKET UNSET → TTL ... DELETE only; no storage
--                     policy. The base table is then a PLAIN MergeTree, so it
--                     runs on a vanilla ClickHouse with no S3 disk configured.
--
-- Idempotent via CREATE TABLE IF NOT EXISTS — re-running is a no-op.
CREATE TABLE IF NOT EXISTS {database}.lake_events
(
  organizationId  String,
  pipelineId      String,
  eventType       Enum8('log' = 1, 'metric' = 2, 'trace' = 3),
  timestamp       DateTime64(3),
  traceId         String,
  spanId          String,
  host            String,
  source          String,
  severity        String,
  message         String,
  raw             String,
  attrs           Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (organizationId, pipelineId, timestamp)
{ttl}
