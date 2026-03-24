import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/vrl/function-registry", () => ({
  buildVrlReferenceFromRegistry: vi.fn(() => "STUB_VRL_REFERENCE"),
}));

import {
  buildVrlSystemPrompt,
  buildVrlChatSystemPrompt,
  buildPipelineSystemPrompt,
} from "../prompts";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("buildVrlSystemPrompt", () => {
  it("includes VRL function reference", () => {
    const result = buildVrlSystemPrompt({});
    expect(result).toContain("STUB_VRL_REFERENCE");
  });

  it("includes fields when provided", () => {
    const result = buildVrlSystemPrompt({
      fields: [{ name: "message", type: "string" }],
    });
    expect(result).toContain(".message (string)");
  });

  it("includes currentCode when provided", () => {
    const result = buildVrlSystemPrompt({
      currentCode: '.tag = "hello"',
    });
    expect(result).toContain('.tag = "hello"');
  });

  it("includes sourceTypes when provided", () => {
    const result = buildVrlSystemPrompt({
      sourceTypes: ["syslog", "kafka"],
    });
    expect(result).toContain("syslog, kafka");
  });

  it("includes componentType when provided", () => {
    const result = buildVrlSystemPrompt({
      componentType: "remap",
    });
    expect(result).toContain("remap");
  });
});

describe("buildVrlChatSystemPrompt", () => {
  it("includes VRL function reference", () => {
    const result = buildVrlChatSystemPrompt({});
    expect(result).toContain("STUB_VRL_REFERENCE");
  });

  it("includes JSON response format instructions", () => {
    const result = buildVrlChatSystemPrompt({});
    expect(result).toContain("insert_code");
    expect(result).toContain("replace_code");
    expect(result).toContain("remove_code");
    expect(result).toContain("summary");
  });

  it("includes fields when provided", () => {
    const result = buildVrlChatSystemPrompt({
      fields: [{ name: "host", type: "string" }],
    });
    expect(result).toContain(".host (string)");
  });

  it("includes currentCode when provided", () => {
    const result = buildVrlChatSystemPrompt({
      currentCode: ".x = 1",
    });
    expect(result).toContain(".x = 1");
  });
});

describe("buildPipelineSystemPrompt", () => {
  describe("generate mode", () => {
    it("includes Vector YAML generation instructions", () => {
      const result = buildPipelineSystemPrompt({ mode: "generate" });
      expect(result).toContain("Vector pipeline generator");
      expect(result).toContain("YAML");
    });

    it("includes currentYaml when provided", () => {
      const result = buildPipelineSystemPrompt({
        mode: "generate",
        currentYaml: "sources:\n  my_src:\n    type: demo_logs",
      });
      expect(result).toContain("my_src");
    });

    it("includes environmentName when provided", () => {
      const result = buildPipelineSystemPrompt({
        mode: "generate",
        environmentName: "production",
      });
      expect(result).toContain("production");
    });
  });

  describe("review mode", () => {
    it("includes JSON response format instructions", () => {
      const result = buildPipelineSystemPrompt({ mode: "review" });
      expect(result).toContain("JSON");
      expect(result).toContain("modify_config");
      expect(result).toContain("modify_vrl");
    });

    it("includes suggestion type documentation", () => {
      const result = buildPipelineSystemPrompt({ mode: "review" });
      expect(result).toContain("add_component");
      expect(result).toContain("remove_component");
      expect(result).toContain("modify_connections");
    });

    it("includes currentYaml when provided", () => {
      const result = buildPipelineSystemPrompt({
        mode: "review",
        currentYaml: "transforms:\n  parse:\n    type: remap",
      });
      expect(result).toContain("parse");
    });
  });

  describe("metric context integration", () => {
    it("includes metric context section in review mode when provided", () => {
      const metricText = 'Component "kafka_source": recv=100.0 ev/s, sent=95.0 ev/s, errors=2 (0.3/s), latency=5.0ms';
      const result = buildPipelineSystemPrompt({
        mode: "review",
        metricContext: metricText,
      });
      expect(result).toContain("=== Live Pipeline Metrics ===");
      expect(result).toContain(metricText);
    });

    it("includes instruction to flag high error rates", () => {
      const result = buildPipelineSystemPrompt({
        mode: "review",
        metricContext: "some metrics",
      });
      expect(result).toContain("flag components with high error rates");
    });

    it("omits metric section in review mode when metricContext is undefined", () => {
      const result = buildPipelineSystemPrompt({ mode: "review" });
      expect(result).not.toContain("Live Pipeline Metrics");
    });

    it("omits metric section in generate mode even when metricContext is provided", () => {
      const result = buildPipelineSystemPrompt({
        mode: "generate",
        metricContext: "some metrics",
      });
      expect(result).not.toContain("Live Pipeline Metrics");
      expect(result).not.toContain("some metrics");
    });
  });
});
