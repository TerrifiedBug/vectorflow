// src/lib/ai/metric-context.ts

import type { MetricSample } from "@/server/services/metric-store";

const MAX_COMPONENTS = 20;
const TOP_N = 10;

interface ComponentSummary {
  componentId: string;
  receivedEventsRate: number;
  sentEventsRate: number;
  errorCount: number;
  errorsRate: number;
  latencyMeanMs: number | null;
}

function summarizeComponent(
  componentId: string,
  samples: MetricSample[],
): ComponentSummary | null {
  if (samples.length === 0) return null;
  const latest = samples[samples.length - 1];
  return {
    componentId,
    receivedEventsRate: latest.receivedEventsRate,
    sentEventsRate: latest.sentEventsRate,
    errorCount: latest.errorCount,
    errorsRate: latest.errorsRate,
    latencyMeanMs: latest.latencyMeanMs,
  };
}

function formatComponent(s: ComponentSummary): string {
  const latency =
    s.latencyMeanMs != null
      ? `latency=${s.latencyMeanMs.toFixed(1)}ms`
      : "latency=N/A";
  return `Component "${s.componentId}": recv=${s.receivedEventsRate.toFixed(1)} ev/s, sent=${s.sentEventsRate.toFixed(1)} ev/s, errors=${s.errorCount} (${s.errorsRate.toFixed(1)}/s), ${latency}`;
}

/**
 * Converts MetricStore.getAllForPipeline() output into a token-efficient text
 * block suitable for injection into AI review prompts.
 *
 * If the map is empty or all component sample arrays are empty, returns a
 * fallback message. For >20 components, truncates to the top 10 by error rate
 * and top 10 by throughput (deduped), keeping output under ~8000 chars
 * (~2000 tokens).
 */
export function buildMetricContext(
  metrics: Map<string, MetricSample[]>,
): string {
  if (metrics.size === 0) {
    return "No recent metrics available for this pipeline.";
  }

  // Summarize each component from the latest sample
  const summaries: ComponentSummary[] = [];
  for (const [componentId, samples] of metrics) {
    const summary = summarizeComponent(componentId, samples);
    if (summary) summaries.push(summary);
  }

  if (summaries.length === 0) {
    return "No recent metrics available for this pipeline.";
  }

  let selected: ComponentSummary[];
  let omittedCount = 0;

  if (summaries.length <= MAX_COMPONENTS) {
    // Sort by error rate descending for readability
    selected = [...summaries].sort((a, b) => b.errorsRate - a.errorsRate);
  } else {
    // Truncation: top 10 by error rate + top 10 by throughput (deduped)
    const byErrors = [...summaries].sort((a, b) => b.errorsRate - a.errorsRate);
    const byThroughput = [...summaries].sort(
      (a, b) => b.receivedEventsRate - a.receivedEventsRate,
    );

    const seen = new Set<string>();
    selected = [];

    for (const s of byErrors) {
      if (selected.length >= TOP_N) break;
      if (!seen.has(s.componentId)) {
        seen.add(s.componentId);
        selected.push(s);
      }
    }
    for (const s of byThroughput) {
      if (selected.length >= TOP_N * 2) break;
      if (!seen.has(s.componentId)) {
        seen.add(s.componentId);
        selected.push(s);
      }
    }

    omittedCount = summaries.length - selected.length;
  }

  const lines = selected.map(formatComponent);

  if (omittedCount > 0) {
    lines.push(`... and ${omittedCount} more components (omitted for brevity)`);
  }

  return lines.join("\n");
}
