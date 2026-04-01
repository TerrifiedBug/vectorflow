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
  };
}

export const ALERT_RULE_TEMPLATES: AlertRuleTemplate[] = [
  {
    id: "high-cpu",
    name: "High CPU Usage",
    description: "Alert when CPU utilisation exceeds 90% for 60 seconds.",
    icon: Cpu,
    defaults: {
      metric: "cpu_usage",
      condition: "gt",
      threshold: "90",
      durationSeconds: "60",
    },
  },
  {
    id: "high-memory",
    name: "High Memory Usage",
    description: "Alert when memory utilisation exceeds 85% for 60 seconds.",
    icon: MemoryStick,
    defaults: {
      metric: "memory_usage",
      condition: "gt",
      threshold: "85",
      durationSeconds: "60",
    },
  },
  {
    id: "high-disk",
    name: "High Disk Usage",
    description: "Alert when disk utilisation exceeds 90% for 2 minutes.",
    icon: HardDrive,
    defaults: {
      metric: "disk_usage",
      condition: "gt",
      threshold: "90",
      durationSeconds: "120",
    },
  },
  {
    id: "high-error-rate",
    name: "High Error Rate",
    description: "Alert when the error rate exceeds 5% for 30 seconds.",
    icon: AlertTriangle,
    defaults: {
      metric: "error_rate",
      condition: "gt",
      threshold: "5",
      durationSeconds: "30",
    },
  },
  {
    id: "node-offline",
    name: "Node Offline",
    description: "Alert immediately when a node becomes unreachable.",
    icon: ServerOff,
    defaults: {
      metric: "node_unreachable",
      condition: "eq",
      threshold: "1",
      durationSeconds: "0",
    },
  },
  {
    id: "pipeline-crashed",
    name: "Pipeline Crashed",
    description: "Alert immediately when a pipeline process crashes.",
    icon: CircleX,
    defaults: {
      metric: "pipeline_crashed",
      condition: "eq",
      threshold: "1",
      durationSeconds: "0",
    },
  },
  {
    id: "high-discard-rate",
    name: "High Discard Rate",
    description: "Alert when the discard rate exceeds 10% for 60 seconds.",
    icon: Trash2,
    defaults: {
      metric: "discarded_rate",
      condition: "gt",
      threshold: "10",
      durationSeconds: "60",
    },
  },
  {
    id: "fleet-error-rate",
    name: "Fleet Error Rate",
    description:
      "Alert when total error rate across all pipelines exceeds 5% for 60 seconds.",
    icon: AlertTriangle,
    defaults: {
      metric: "fleet_error_rate",
      condition: "gt",
      threshold: "5",
      durationSeconds: "60",
    },
  },
  {
    id: "fleet-throughput-drop",
    name: "Fleet Throughput Drop",
    description:
      "Alert when total throughput drops by 20% compared to previous period for 2 minutes.",
    icon: TrendingDown,
    defaults: {
      metric: "fleet_throughput_drop",
      condition: "gt",
      threshold: "20",
      durationSeconds: "120",
    },
  },
  {
    id: "fleet-event-volume",
    name: "Fleet Event Volume",
    description:
      "Alert when total event volume drops below 1000 events for 60 seconds.",
    icon: Activity,
    defaults: {
      metric: "fleet_event_volume",
      condition: "lt",
      threshold: "1000",
      durationSeconds: "60",
    },
  },
  {
    id: "node-load-imbalance",
    name: "Node Load Imbalance",
    description:
      "Alert when any node deviates from fleet average by more than 30% for 2 minutes.",
    icon: Scale,
    defaults: {
      metric: "node_load_imbalance",
      condition: "gt",
      threshold: "30",
      durationSeconds: "120",
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
      durationSeconds: "0",
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
      durationSeconds: "60",
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
    },
  },
];
