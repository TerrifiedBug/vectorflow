/**
 * Pre-built alert rule templates for common monitoring scenarios.
 *
 * Each template maps to a partial RuleFormState so the create dialog can
 * pre-fill values when the user picks a template.  The `icon` field is a
 * lucide-react icon name (resolved at render time in the picker component).
 */

import type { LucideIcon } from "lucide-react";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  AlertTriangle,
  ServerOff,
  CircleX,
  Trash2,
  TrendingDown,
  Activity,
  Timer,
  Gauge,
  Scale,
  GitCompareArrows,
  FileWarning,
  Search,
} from "lucide-react";

export interface AlertRuleTemplate {
  /** Unique template key (used as React key). */
  id: string;
  /** Human-readable name shown on the template card. */
  name: string;
  /** Short description of what this template monitors. */
  description: string;
  /** Lucide icon component rendered on the card. */
  icon: LucideIcon;
  /** Pre-filled form values. */
  defaults: {
    metric: string;
    condition: string;
    threshold: string;
    durationSeconds: string;
    severity: "info" | "warning" | "critical";
    ownerHint: string;
    suggestedAction: string;
  };
}

export const ALERT_RULE_TEMPLATES: AlertRuleTemplate[] = [
  {
    id: "high-cpu",
    name: "High CPU Usage",
    description: "Alert when CPU utilisation exceeds 90% for 10 minutes.",
    icon: Cpu,
    defaults: {
      metric: "cpu_usage",
      condition: "gt",
      threshold: "90",
      durationSeconds: "600",
      severity: "warning",
      ownerHint: "platform-ops",
      suggestedAction:
        "Check node CPU saturation, noisy pipelines, and recent deploys; scale or move workloads if sustained.",
    },
  },
  {
    id: "high-memory",
    name: "High Memory Usage",
    description: "Alert when memory utilisation exceeds 85% for 10 minutes.",
    icon: MemoryStick,
    defaults: {
      metric: "memory_usage",
      condition: "gt",
      threshold: "85",
      durationSeconds: "600",
      severity: "warning",
      ownerHint: "platform-ops",
      suggestedAction:
        "Inspect memory pressure and pipeline buffers on the node; restart or scale only after confirming growth is sustained.",
    },
  },
  {
    id: "high-disk",
    name: "High Disk Usage",
    description: "Alert when disk utilisation exceeds 90% for 15 minutes.",
    icon: HardDrive,
    defaults: {
      metric: "disk_usage",
      condition: "gt",
      threshold: "90",
      durationSeconds: "900",
      severity: "warning",
      ownerHint: "platform-ops",
      suggestedAction:
        "Free disk space or expand storage, then check Vector data directories and retained logs.",
    },
  },
  {
    id: "high-error-rate",
    name: "High Error Rate",
    description: "Alert when the error rate exceeds 5% for 5 minutes.",
    icon: AlertTriangle,
    defaults: {
      metric: "error_rate",
      condition: "gt",
      threshold: "5",
      durationSeconds: "300",
      severity: "warning",
      ownerHint: "pipeline-owner",
      suggestedAction:
        "Inspect pipeline error logs, sink connectivity, and upstream payload changes before increasing thresholds.",
    },
  },
  {
    id: "node-offline",
    name: "Node Offline",
    description: "Alert when a node stays unreachable for 2 minutes.",
    icon: ServerOff,
    defaults: {
      metric: "node_unreachable",
      condition: "eq",
      threshold: "1",
      durationSeconds: "120",
      severity: "critical",
      ownerHint: "platform-ops",
      suggestedAction:
        "Check host reachability, agent health, and network policy for the affected node.",
    },
  },
  {
    id: "pipeline-crashed",
    name: "Pipeline Crashed",
    description: "Alert when a pipeline process stays crashed for 1 minute.",
    icon: CircleX,
    defaults: {
      metric: "pipeline_crashed",
      condition: "eq",
      threshold: "1",
      durationSeconds: "60",
      severity: "critical",
      ownerHint: "pipeline-owner",
      suggestedAction:
        "Inspect Vector process logs on the node, compare with the last deployed config, and roll back if needed.",
    },
  },
  {
    id: "high-discard-rate",
    name: "High Discard Rate",
    description: "Alert when the discard rate exceeds 10% for 5 minutes.",
    icon: Trash2,
    defaults: {
      metric: "discarded_rate",
      condition: "gt",
      threshold: "10",
      durationSeconds: "300",
      severity: "warning",
      ownerHint: "pipeline-owner",
      suggestedAction:
        "Review dropped-event reasons and sink backpressure; confirm whether sampling or filters changed.",
    },
  },
  {
    id: "high-pipeline-latency",
    name: "High Pipeline Latency",
    description: "Alert when a pipeline's mean latency exceeds 2000ms for 5 minutes.",
    icon: Timer,
    defaults: {
      metric: "latency_mean",
      condition: "gt",
      threshold: "2000",
      durationSeconds: "300",
      severity: "warning",
      ownerHint: "pipeline-owner",
      suggestedAction:
        "Check downstream sink latency and buffering; reduce ingest or scale the pipeline if backpressure persists.",
    },
  },
  {
    id: "low-pipeline-throughput",
    name: "Pipeline Throughput Floor",
    description: "Alert when a pipeline's throughput drops below 1 event/sec for 5 minutes.",
    icon: Gauge,
    defaults: {
      metric: "throughput_floor",
      condition: "lt",
      threshold: "1",
      durationSeconds: "300",
      severity: "warning",
      ownerHint: "pipeline-owner",
      suggestedAction:
        "Verify upstream traffic, recent deploys, and node health before treating this as an ingestion outage.",
    },
  },
  {
    id: "fleet-error-rate",
    name: "Fleet Error Rate",
    description:
      "Alert when total error rate across all pipelines exceeds 5% for 5 minutes.",
    icon: AlertTriangle,
    defaults: {
      metric: "fleet_error_rate",
      condition: "gt",
      threshold: "5",
      durationSeconds: "300",
      severity: "warning",
      ownerHint: "platform-ops",
      suggestedAction:
        "Identify top contributing pipelines and nodes, then inspect shared sinks or upstream format changes.",
    },
  },
  {
    id: "fleet-throughput-drop",
    name: "Fleet Throughput Drop",
    description:
      "Alert when total throughput drops by 20% compared to previous period for 5 minutes.",
    icon: TrendingDown,
    defaults: {
      metric: "fleet_throughput_drop",
      condition: "gt",
      threshold: "20",
      durationSeconds: "300",
      severity: "warning",
      ownerHint: "platform-ops",
      suggestedAction:
        "Compare current ingest against historical baselines and check shared source, network, or deploy changes.",
    },
  },
  {
    id: "fleet-event-volume",
    name: "Fleet Event Volume",
    description:
      "Alert when total event volume drops below 1000 events for 5 minutes.",
    icon: Activity,
    defaults: {
      metric: "fleet_event_volume",
      condition: "lt",
      threshold: "1000",
      durationSeconds: "300",
      severity: "warning",
      ownerHint: "platform-ops",
      suggestedAction:
        "Verify expected traffic patterns, source availability, and ingestion gaps across the fleet.",
    },
  },
  {
    id: "node-load-imbalance",
    name: "Node Load Imbalance",
    description:
      "Alert when any node deviates from fleet average by more than 30% for 5 minutes.",
    icon: Scale,
    defaults: {
      metric: "node_load_imbalance",
      condition: "gt",
      threshold: "30",
      durationSeconds: "300",
      severity: "warning",
      ownerHint: "platform-ops",
      suggestedAction:
        "Inspect node assignment and capacity; rebalance pipelines if one node is carrying disproportionate load.",
    },
  },
  {
    id: "version-drift",
    name: "Version Drift",
    description:
      "Alert when any pipeline has nodes running different versions from the latest deployed version.",
    icon: GitCompareArrows,
    defaults: {
      metric: "version_drift",
      condition: "gt",
      threshold: "0",
      durationSeconds: "300",
      severity: "warning",
      ownerHint: "release-owner",
      suggestedAction:
        "Compare deployed versions across nodes and complete, roll back, or reconcile the rollout.",
    },
  },
  {
    id: "config-drift",
    name: "Config Drift",
    description:
      "Alert when a node's running config doesn't match the server's expected config for 60 seconds.",
    icon: FileWarning,
    defaults: {
      metric: "config_drift",
      condition: "gt",
      threshold: "0",
      durationSeconds: "300",
      severity: "warning",
      ownerHint: "release-owner",
      suggestedAction:
        "Compare running config against the server config and redeploy or investigate unauthorized local changes.",
    },
  },
  {
    id: "log-keyword",
    name: "Log Keyword",
    description: "Alert when a keyword appears in pipeline logs more than 3 times in 5 minutes.",
    icon: Search,
    defaults: {
      metric: "log_keyword",
      condition: "gt",
      threshold: "3",
      durationSeconds: "",
      severity: "warning",
      ownerHint: "pipeline-owner",
      suggestedAction:
        "Review matching log samples, tune the keyword if noisy, and route to the owning pipeline team.",
    },
  },
];
