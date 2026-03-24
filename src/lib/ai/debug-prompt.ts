// src/lib/ai/debug-prompt.ts

import type { SliResult, SliStatus } from "@/server/services/sli-evaluator";

const YAML_CHAR_LIMIT = 16_000;

/**
 * Formats SLI evaluation results into a human-readable text block.
 * Returns a fallback message when no SLI definitions exist.
 */
export function formatSliResults(
  sliStatus: SliStatus,
  slis: SliResult[],
): string {
  if (slis.length === 0) {
    return "No SLI definitions configured for this pipeline.";
  }

  const statusLabel =
    sliStatus === "healthy"
      ? "HEALTHY"
      : sliStatus === "degraded"
        ? "DEGRADED"
        : "NO DATA";

  const lines: string[] = [`Overall SLI status: ${statusLabel}`];

  for (const sli of slis) {
    const status = sli.status.toUpperCase();
    const value = sli.value != null ? String(sli.value) : "N/A";
    lines.push(
      `- ${sli.metric}: ${status} (value=${value}, threshold=${sli.threshold}, condition=${sli.condition})`,
    );
  }

  return lines.join("\n");
}

/**
 * Formats recent log entries into a timestamped text block.
 * Returns a fallback message when no log entries exist.
 */
export function formatLogLines(
  logs: Array<{ timestamp: Date | string; level: string; message: string }>,
): string {
  if (logs.length === 0) {
    return "No recent error logs.";
  }

  return logs
    .map((log) => {
      const ts =
        log.timestamp instanceof Date
          ? log.timestamp.toISOString()
          : log.timestamp;
      return `[${ts}] ${log.level.toUpperCase()}: ${log.message}`;
    })
    .join("\n");
}

/**
 * Assembles a full debugging system prompt from pipeline YAML, metric context,
 * SLI evaluation results, and recent log lines.
 *
 * Handles all combinations of present/missing data gracefully — each section
 * falls back to an informative message when data is unavailable.
 *
 * YAML is truncated at 16K chars to stay within token budget.
 * Metric context is assumed to be already budget-enforced by `buildMetricContext`.
 */
export function buildDebugSystemPrompt(params: {
  yaml?: string;
  metricContext?: string;
  sliResults?: { status: SliStatus; slis: SliResult[] };
  logLines?: Array<{
    timestamp: Date | string;
    level: string;
    message: string;
  }>;
}): string {
  const parts: string[] = [];

  // System role
  parts.push(
    "You are a Vector pipeline debugging assistant. You help users diagnose pipeline issues by analyzing their pipeline configuration, metrics, SLI health, and recent logs.",
    "When answering questions, reference specific component names, metric values, and configuration details from the context provided below.",
    "",
  );

  // === Pipeline Configuration (YAML) ===
  parts.push("=== Pipeline Configuration (YAML) ===");
  if (params.yaml && params.yaml.trim().length > 0) {
    if (params.yaml.length > YAML_CHAR_LIMIT) {
      parts.push(params.yaml.slice(0, YAML_CHAR_LIMIT));
      parts.push(
        `[Pipeline YAML truncated — showing first ${YAML_CHAR_LIMIT} characters of ${params.yaml.length} total]`,
      );
    } else {
      parts.push(params.yaml);
    }
  } else {
    parts.push("No pipeline configuration provided.");
  }
  parts.push("");

  // === Live Pipeline Metrics ===
  parts.push("=== Live Pipeline Metrics ===");
  if (params.metricContext && params.metricContext.trim().length > 0) {
    parts.push(params.metricContext);
  } else {
    parts.push("No recent metrics available.");
  }
  parts.push("");

  // === SLI Health ===
  parts.push("=== SLI Health ===");
  if (params.sliResults) {
    parts.push(
      formatSliResults(params.sliResults.status, params.sliResults.slis),
    );
  } else {
    parts.push("No SLI data available.");
  }
  parts.push("");

  // === Recent Error Logs ===
  parts.push("=== Recent Error Logs ===");
  if (params.logLines && params.logLines.length > 0) {
    parts.push(formatLogLines(params.logLines));
  } else {
    parts.push("No recent error logs.");
  }
  parts.push("");

  // Instructions
  parts.push(
    "When diagnosing issues, reference specific components by name, cite exact metric values, and point to relevant configuration lines. If SLIs are breached, explain which thresholds were violated and suggest remediation steps.",
  );

  return parts.join("\n");
}
