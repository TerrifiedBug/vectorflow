import { describe, it, expect } from "vitest";
import {
  buildDebugSystemPrompt,
  formatSliResults,
  formatLogLines,
} from "../debug-prompt";
import type { SliResult } from "@/server/services/sli-evaluator";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSliResult(overrides: Partial<SliResult> = {}): SliResult {
  return {
    metric: "error_rate",
    status: "met",
    value: 0.01,
    threshold: 0.05,
    condition: "lt",
    ...overrides,
  };
}

function makeLogEntry(overrides: Partial<{ timestamp: Date | string; level: string; message: string }> = {}) {
  return {
    timestamp: "2025-06-15T12:00:00.000Z",
    level: "ERROR",
    message: "Connection refused",
    ...overrides,
  };
}

function generateLargeYaml(chars: number): string {
  const base = "sources:\n  kafka_source:\n    type: kafka\n    bootstrap_servers: localhost:9092\n";
  // Repeat a comment line to reach target length
  const padding = "# padding line for large yaml test\n";
  let yaml = base;
  while (yaml.length < chars) {
    yaml += padding;
  }
  return yaml.slice(0, chars);
}

// ─── buildDebugSystemPrompt ─────────────────────────────────────────────────

describe("buildDebugSystemPrompt", () => {
  it("includes all four sections when all data is provided", () => {
    const result = buildDebugSystemPrompt({
      yaml: "sources:\n  my_source:\n    type: demo",
      metricContext: 'Component "my_source": recv=100.0 ev/s',
      sliResults: {
        status: "healthy",
        slis: [makeSliResult()],
      },
      logLines: [makeLogEntry()],
    });

    expect(result).toContain("=== Pipeline Configuration (YAML) ===");
    expect(result).toContain("=== Live Pipeline Metrics ===");
    expect(result).toContain("=== SLI Health ===");
    expect(result).toContain("=== Recent Error Logs ===");
    expect(result).toContain("my_source");
    expect(result).toContain("recv=100.0 ev/s");
    expect(result).toContain("error_rate: MET");
    expect(result).toContain("Connection refused");
  });

  it("handles undefined YAML with fallback text", () => {
    const result = buildDebugSystemPrompt({});
    expect(result).toContain("No pipeline configuration provided.");
  });

  it("handles empty string YAML with fallback text", () => {
    const result = buildDebugSystemPrompt({ yaml: "   " });
    expect(result).toContain("No pipeline configuration provided.");
  });

  it("handles undefined metricContext with fallback text", () => {
    const result = buildDebugSystemPrompt({});
    expect(result).toContain("No recent metrics available.");
  });

  it("handles empty string metricContext with fallback text", () => {
    const result = buildDebugSystemPrompt({ metricContext: "  " });
    expect(result).toContain("No recent metrics available.");
  });

  it("handles undefined sliResults with fallback text", () => {
    const result = buildDebugSystemPrompt({});
    expect(result).toContain("No SLI data available.");
  });

  it("handles undefined logLines with fallback text", () => {
    const result = buildDebugSystemPrompt({});
    expect(result).toContain("No recent error logs.");
  });

  it("handles empty logLines array with fallback text", () => {
    const result = buildDebugSystemPrompt({ logLines: [] });
    expect(result).toContain("No recent error logs.");
  });

  it("handles ALL data missing — all fallback sections, still valid prompt", () => {
    const result = buildDebugSystemPrompt({});

    // All four fallback messages present
    expect(result).toContain("No pipeline configuration provided.");
    expect(result).toContain("No recent metrics available.");
    expect(result).toContain("No SLI data available.");
    expect(result).toContain("No recent error logs.");

    // Still has section headers and role instructions
    expect(result).toContain("=== Pipeline Configuration (YAML) ===");
    expect(result).toContain("=== Live Pipeline Metrics ===");
    expect(result).toContain("=== SLI Health ===");
    expect(result).toContain("=== Recent Error Logs ===");
    expect(result).toContain("debugging assistant");
  });

  it("truncates large YAML over 16000 chars with notice including original length", () => {
    const largeYaml = generateLargeYaml(20_000);
    const result = buildDebugSystemPrompt({ yaml: largeYaml });

    expect(result).toContain(
      "[Pipeline YAML truncated — showing first 16000 characters of 20000 total]",
    );
    // Should NOT contain all 20000 chars of YAML
    expect(result).not.toContain(largeYaml);
  });

  it("does NOT truncate YAML at exactly 16000 chars", () => {
    const exactYaml = generateLargeYaml(16_000);
    const result = buildDebugSystemPrompt({ yaml: exactYaml });

    expect(result).not.toContain("[Pipeline YAML truncated");
    expect(result).toContain(exactYaml);
  });

  it("full prompt with realistic 50-component YAML stays under 50000 chars", () => {
    // Generate a realistic large YAML (~15000 chars to stay under truncation)
    const components: string[] = ["sources:"];
    for (let i = 0; i < 50; i++) {
      components.push(
        `  component_${i.toString().padStart(2, "0")}:`,
        `    type: demo_logs`,
        `    interval: 1`,
        `    format: json`,
      );
    }
    const yaml = components.join("\n");

    const slis: SliResult[] = Array.from({ length: 5 }, (_, i) =>
      makeSliResult({ metric: `metric_${i}`, value: i * 0.01 }),
    );

    const logs = Array.from({ length: 20 }, (_, i) =>
      makeLogEntry({ message: `Error in component_${i}: connection timeout` }),
    );

    const metricLines = Array.from(
      { length: 20 },
      (_, i) => `Component "component_${i}": recv=100.0 ev/s, sent=95.0 ev/s, errors=2`,
    ).join("\n");

    const result = buildDebugSystemPrompt({
      yaml,
      metricContext: metricLines,
      sliResults: { status: "degraded", slis },
      logLines: logs,
    });

    expect(result.length).toBeLessThan(50_000);
  });

  it("system role contains 'debugging' keyword", () => {
    const result = buildDebugSystemPrompt({});
    expect(result).toContain("debugging");
  });
});

// ─── formatSliResults ───────────────────────────────────────────────────────

describe("formatSliResults", () => {
  it("formats met/breached/no_data statuses correctly", () => {
    const slis: SliResult[] = [
      makeSliResult({ metric: "error_rate", status: "met", value: 0.01, threshold: 0.05, condition: "lt" }),
      makeSliResult({ metric: "throughput_floor", status: "breached", value: 5, threshold: 100, condition: "gt" }),
      makeSliResult({ metric: "latency_mean", status: "no_data", value: null, threshold: 200, condition: "lt" }),
    ];

    const result = formatSliResults("degraded", slis);

    expect(result).toContain("error_rate: MET (value=0.01, threshold=0.05, condition=lt)");
    expect(result).toContain("throughput_floor: BREACHED (value=5, threshold=100, condition=gt)");
    expect(result).toContain("latency_mean: NO_DATA (value=N/A, threshold=200, condition=lt)");
  });

  it("returns 'No SLI definitions' message for empty slis array", () => {
    const result = formatSliResults("no_data", []);
    expect(result).toBe("No SLI definitions configured for this pipeline.");
  });

  it("shows overall status healthy", () => {
    const result = formatSliResults("healthy", [makeSliResult()]);
    expect(result).toContain("Overall SLI status: HEALTHY");
  });

  it("shows overall status degraded", () => {
    const result = formatSliResults("degraded", [makeSliResult({ status: "breached" })]);
    expect(result).toContain("Overall SLI status: DEGRADED");
  });

  it("shows overall status no_data", () => {
    const result = formatSliResults("no_data", [makeSliResult({ status: "no_data", value: null })]);
    expect(result).toContain("Overall SLI status: NO DATA");
  });
});

// ─── formatLogLines ─────────────────────────────────────────────────────────

describe("formatLogLines", () => {
  it("formats timestamps + levels + messages correctly", () => {
    const result = formatLogLines([
      { timestamp: "2025-06-15T12:00:00.000Z", level: "error", message: "Connection refused" },
      { timestamp: "2025-06-15T12:01:00.000Z", level: "warn", message: "Slow response" },
    ]);

    expect(result).toContain("[2025-06-15T12:00:00.000Z] ERROR: Connection refused");
    expect(result).toContain("[2025-06-15T12:01:00.000Z] WARN: Slow response");
  });

  it("returns 'No recent error logs.' for empty array", () => {
    const result = formatLogLines([]);
    expect(result).toBe("No recent error logs.");
  });

  it("handles Date objects as timestamps", () => {
    const date = new Date("2025-06-15T14:30:00.000Z");
    const result = formatLogLines([
      { timestamp: date, level: "ERROR", message: "Disk full" },
    ]);

    expect(result).toContain("[2025-06-15T14:30:00.000Z] ERROR: Disk full");
  });

  it("handles ISO string timestamps", () => {
    const result = formatLogLines([
      { timestamp: "2025-12-25T00:00:00.000Z", level: "error", message: "Holiday failure" },
    ]);

    expect(result).toContain("[2025-12-25T00:00:00.000Z] ERROR: Holiday failure");
  });
});
