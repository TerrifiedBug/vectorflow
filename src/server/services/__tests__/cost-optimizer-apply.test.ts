import { describe, it, expect } from "vitest";
import { applyRecommendationToYaml } from "@/server/services/cost-optimizer-apply";
import type { SuggestedAction } from "@/server/services/cost-optimizer-types";

describe("applyRecommendationToYaml", () => {
  const baseYaml = [
    "sources:",
    "  syslog_source:",
    "    type: syslog",
    "    address: 0.0.0.0:514",
    "transforms:",
    "  parse_logs:",
    "    type: remap",
    "    inputs:",
    "      - syslog_source",
    '    source: ". = parse_syslog!(.message)"',
    "sinks:",
    "  opensearch_prod:",
    "    type: elasticsearch",
    "    inputs:",
    "      - parse_logs",
    "    endpoints:",
    "      - https://es.example.com",
  ].join("\n");

  it("applies add_sampling — inserts sample transform and rewires sink", () => {
    const action: SuggestedAction = {
      type: "add_sampling",
      config: { rate: 10, componentKey: "sample_logs" },
    };
    const result = applyRecommendationToYaml(baseYaml, action, "opensearch_prod");
    expect(result).toContain("sample_logs:");
    expect(result).toContain("type: sample");
    expect(result).toContain("rate: 10");
    expect(result).toMatch(/opensearch_prod:[\s\S]*inputs:[\s\S]*- sample_logs/);
  });

  it("applies add_filter — inserts filter transform and rewires sink", () => {
    const action: SuggestedAction = {
      type: "add_filter",
      config: {
        condition: '.level != "error" && !is_nullish(.message)',
        componentKey: "error_filter",
      },
    };
    const result = applyRecommendationToYaml(baseYaml, action, "opensearch_prod");
    expect(result).toContain("error_filter:");
    expect(result).toContain("type: filter");
    expect(result).toContain("condition:");
    expect(result).toMatch(/opensearch_prod:[\s\S]*inputs:[\s\S]*- error_filter/);
  });

  it("returns null for disable_pipeline (no YAML change)", () => {
    const action: SuggestedAction = {
      type: "disable_pipeline",
      config: {},
    };
    const result = applyRecommendationToYaml(baseYaml, action, "opensearch_prod");
    expect(result).toBeNull();
  });

  it("preserves existing transforms when adding a new one", () => {
    const action: SuggestedAction = {
      type: "add_sampling",
      config: { rate: 5, componentKey: "sample_logs" },
    };
    const result = applyRecommendationToYaml(baseYaml, action, "opensearch_prod");
    expect(result).toContain("parse_logs:");
    expect(result).toContain("type: remap");
    expect(result).toContain("sample_logs:");
  });
});
