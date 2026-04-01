import { describe, it, expect } from "vitest";
import { buildCostRecommendationPrompt } from "@/lib/ai/cost-recommendation-prompt";

describe("buildCostRecommendationPrompt", () => {
  it("includes pipeline suggestion schema for LOW_REDUCTION with nodes", () => {
    const result = buildCostRecommendationPrompt({
      type: "LOW_REDUCTION",
      title: 'Pipeline "nginx-logs" has minimal data reduction',
      description: "This pipeline processed 50 GB...",
      analysisData: { bytesIn: "50000000000", reductionRatio: 0.02 },
      suggestedAction: { type: "add_filter", config: { condition: '.level != "debug"' } },
      pipelineName: "nginx-logs",
      nodes: [
        { componentKey: "nginx_source", componentType: "file", kind: "SOURCE", config: { include: ["/var/log/nginx/*.log"] } },
        { componentKey: "parse_logs", componentType: "remap", kind: "TRANSFORM", config: { source: ". = parse_json!(.message)" } },
        { componentKey: "elastic_sink", componentType: "elasticsearch", kind: "SINK", config: { endpoint: "http://es:9200" } },
      ],
    });

    expect(result.system).toContain("cost optimization");
    expect(result.system).toContain("modify_vrl");
    expect(result.system).toContain("add_component");
    expect(result.system).toContain("parse_logs");
    expect(result.system).toContain("parse_json");
    expect(result.user).toContain("LOW_REDUCTION");
    expect(result.user).toContain("nginx-logs");
  });

  it("includes VRL reference for recommendations that may need VRL changes", () => {
    const result = buildCostRecommendationPrompt({
      type: "HIGH_ERROR_RATE",
      title: "High errors",
      description: "10% error rate",
      analysisData: { errorRate: 0.1 },
      suggestedAction: { type: "add_filter", config: { condition: "true" } },
      pipelineName: "test",
      nodes: [
        { componentKey: "remap1", componentType: "remap", kind: "TRANSFORM", config: { source: ".x = 1" } },
      ],
    });

    expect(result.system).toContain("VRL Function Reference");
  });

  it("omits VRL reference for STALE_PIPELINE (no code changes needed)", () => {
    const result = buildCostRecommendationPrompt({
      type: "STALE_PIPELINE",
      title: "Stale pipeline",
      description: "No data in 7 days",
      analysisData: { eventsIn: "0" },
      suggestedAction: { type: "disable_pipeline", config: {} },
      pipelineName: "stale-test",
      nodes: [],
    });

    expect(result.system).not.toContain("VRL Function Reference");
    expect(result.user).toContain("STALE_PIPELINE");
  });

  it("returns user prompt with analysis data", () => {
    const result = buildCostRecommendationPrompt({
      type: "HIGH_ERROR_RATE",
      title: "High error rate",
      description: "Pipeline has elevated error rate",
      analysisData: { errorRate: 0.15, sinkKey: "es_sink" },
      suggestedAction: { type: "add_filter", config: { filterComponentKey: "error_filter" } },
      pipelineName: "error-test",
      nodes: [
        { componentKey: "es_sink", componentType: "elasticsearch", kind: "SINK", config: {} },
      ],
    });

    expect(result.user).toContain("HIGH_ERROR_RATE");
    expect(result.user).toContain("es_sink");
  });
});
