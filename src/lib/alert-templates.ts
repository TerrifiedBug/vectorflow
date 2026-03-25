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
];
