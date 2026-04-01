import {
  MessageSquare,
  Mail,
  AlertTriangle,
  Webhook,
} from "lucide-react";

// ─── Constants shared across alert sections ─────────────────────────────────────

export const METRIC_LABELS: Record<string, string> = {
  // Infrastructure (threshold-based)
  node_unreachable: "Node Unreachable",
  cpu_usage: "CPU Usage",
  memory_usage: "Memory Usage",
  disk_usage: "Disk Usage",
  error_rate: "Error Rate",
  discarded_rate: "Discarded Rate",
  pipeline_crashed: "Pipeline Crashed",
  // Events (fire on occurrence)
  deploy_requested: "Deploy Requested",
  deploy_completed: "Deploy Completed",
  deploy_rejected: "Deploy Rejected",
  deploy_cancelled: "Deploy Cancelled",
  new_version_available: "New Version Available",
  scim_sync_failed: "SCIM Sync Failed",
  backup_failed: "Backup Failed",
  certificate_expiring: "Certificate Expiring",
  node_joined: "Node Joined",
  node_left: "Node Left",
  // Fleet (cluster-wide, evaluated by FleetAlertService)
  fleet_error_rate: "Fleet Error Rate",
  fleet_throughput_drop: "Fleet Throughput Drop",
  fleet_event_volume: "Fleet Event Volume",
  node_load_imbalance: "Node Load Imbalance",
  // Drift detection
  version_drift: "Version Drift",
  config_drift: "Config Drift",
  // Keyword-based log alerts
  log_keyword: "Log Keyword",
};

export const CONDITION_LABELS: Record<string, string> = {
  gt: ">",
  lt: "<",
  eq: "=",
};

export const BINARY_METRICS = new Set(["node_unreachable", "pipeline_crashed"]);

/** Metrics that cannot be scoped to a specific pipeline. */
export const GLOBAL_METRICS = new Set([
  "node_unreachable",
  "new_version_available",
  "scim_sync_failed",
  "backup_failed",
  "certificate_expiring",
  "node_joined",
  "node_left",
  // Fleet metrics are cluster-wide, never pipeline-scoped
  "fleet_error_rate",
  "fleet_throughput_drop",
  "fleet_event_volume",
  "node_load_imbalance",
  "version_drift",
]);

export const CHANNEL_TYPE_LABELS: Record<string, string> = {
  slack: "Slack",
  email: "Email",
  pagerduty: "PagerDuty",
  webhook: "Webhook",
};

export const CHANNEL_TYPE_ICONS: Record<string, typeof MessageSquare> = {
  slack: MessageSquare,
  email: Mail,
  pagerduty: AlertTriangle,
  webhook: Webhook,
};
