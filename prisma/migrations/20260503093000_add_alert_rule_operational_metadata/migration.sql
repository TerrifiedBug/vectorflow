-- Alert rules need explicit operational ownership and action guidance so
-- delivered alerts are actionable without relying on template prose.
ALTER TABLE "AlertRule"
ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'warning',
ADD COLUMN "ownerHint" TEXT NOT NULL DEFAULT 'platform-ops',
ADD COLUMN "suggestedAction" TEXT NOT NULL DEFAULT 'Review the alert context, then inspect the affected pipeline, node, and recent deployment changes.';

-- Backfill existing rules using the same metric-level semantics as the
-- in-app templates and Prometheus rules.
UPDATE "AlertRule"
SET
  "severity" = CASE "metric"
    WHEN 'node_unreachable' THEN 'critical'
    WHEN 'pipeline_crashed' THEN 'critical'
    WHEN 'backup_failed' THEN 'critical'
    WHEN 'certificate_expiring' THEN 'warning'
    ELSE 'warning'
  END,
  "ownerHint" = CASE "metric"
    WHEN 'cpu_usage' THEN 'platform-ops'
    WHEN 'memory_usage' THEN 'platform-ops'
    WHEN 'disk_usage' THEN 'platform-ops'
    WHEN 'node_unreachable' THEN 'platform-ops'
    WHEN 'node_load_imbalance' THEN 'platform-ops'
    WHEN 'node_joined' THEN 'platform-ops'
    WHEN 'node_left' THEN 'platform-ops'
    WHEN 'pipeline_crashed' THEN 'pipeline-owner'
    WHEN 'error_rate' THEN 'pipeline-owner'
    WHEN 'discarded_rate' THEN 'pipeline-owner'
    WHEN 'latency_mean' THEN 'pipeline-owner'
    WHEN 'throughput_floor' THEN 'pipeline-owner'
    WHEN 'fleet_error_rate' THEN 'platform-ops'
    WHEN 'fleet_throughput_drop' THEN 'platform-ops'
    WHEN 'fleet_event_volume' THEN 'platform-ops'
    WHEN 'version_drift' THEN 'release-owner'
    WHEN 'config_drift' THEN 'release-owner'
    WHEN 'deploy_requested' THEN 'release-owner'
    WHEN 'deploy_completed' THEN 'release-owner'
    WHEN 'deploy_rejected' THEN 'release-owner'
    WHEN 'deploy_cancelled' THEN 'release-owner'
    WHEN 'new_version_available' THEN 'release-owner'
    WHEN 'promotion_completed' THEN 'release-owner'
    WHEN 'git_sync_failed' THEN 'release-owner'
    WHEN 'scim_sync_failed' THEN 'identity-admin'
    WHEN 'backup_failed' THEN 'platform-ops'
    WHEN 'certificate_expiring' THEN 'platform-ops'
    WHEN 'cost_threshold_exceeded' THEN 'finops'
    WHEN 'log_keyword' THEN 'pipeline-owner'
    ELSE 'platform-ops'
  END,
  "suggestedAction" = CASE "metric"
    WHEN 'cpu_usage' THEN 'Check node CPU saturation, noisy pipelines, and recent deploys; scale or move workloads if sustained.'
    WHEN 'memory_usage' THEN 'Inspect memory pressure and pipeline buffers on the node; restart or scale only after confirming growth is sustained.'
    WHEN 'disk_usage' THEN 'Free disk space or expand storage, then check Vector data directories and retained logs.'
    WHEN 'error_rate' THEN 'Inspect pipeline error logs, sink connectivity, and upstream payload changes before increasing thresholds.'
    WHEN 'discarded_rate' THEN 'Review dropped-event reasons and sink backpressure; confirm whether sampling or filters changed.'
    WHEN 'node_unreachable' THEN 'Check host reachability, agent health, and network policy for the affected node.'
    WHEN 'pipeline_crashed' THEN 'Inspect Vector process logs on the node, compare with the last deployed config, and roll back if needed.'
    WHEN 'latency_mean' THEN 'Check downstream sink latency and buffering; reduce ingest or scale the pipeline if backpressure persists.'
    WHEN 'throughput_floor' THEN 'Verify upstream traffic, recent deploys, and node health before treating this as an ingestion outage.'
    WHEN 'fleet_error_rate' THEN 'Identify top contributing pipelines and nodes, then inspect shared sinks or upstream format changes.'
    WHEN 'fleet_throughput_drop' THEN 'Compare current ingest against historical baselines and check shared source, network, or deploy changes.'
    WHEN 'fleet_event_volume' THEN 'Verify expected traffic patterns, source availability, and ingestion gaps across the fleet.'
    WHEN 'node_load_imbalance' THEN 'Inspect node assignment and capacity; rebalance pipelines if one node is carrying disproportionate load.'
    WHEN 'version_drift' THEN 'Compare deployed versions across nodes and complete, roll back, or reconcile the rollout.'
    WHEN 'config_drift' THEN 'Compare running config against the server config and redeploy or investigate unauthorized local changes.'
    WHEN 'log_keyword' THEN 'Review matching log samples, tune the keyword if noisy, and route to the owning pipeline team.'
    ELSE 'Review the alert context, then inspect the affected pipeline, node, and recent deployment changes.'
  END;
