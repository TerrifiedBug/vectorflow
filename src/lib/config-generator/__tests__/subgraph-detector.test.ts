import { describe, it, expect } from "vitest";
import { detectSubgraphs } from "../subgraph-detector";
import type { ParsedComponent } from "../vector-parser";

function makeComponent(
  overrides: Partial<ParsedComponent> & Pick<ParsedComponent, "componentKey" | "kind">,
): ParsedComponent {
  return {
    componentType: overrides.componentKey,
    config: {},
    inputs: [],
    catalogMatch: true,
    ...overrides,
  };
}

describe("detectSubgraphs", () => {
  it("detects two independent pipelines as separate subgraphs", () => {
    const components: ParsedComponent[] = [
      makeComponent({ componentKey: "src_a", kind: "source", componentType: "kafka" }),
      makeComponent({ componentKey: "sink_a", kind: "sink", componentType: "http", inputs: ["src_a"] }),
      makeComponent({ componentKey: "src_b", kind: "source", componentType: "file" }),
      makeComponent({ componentKey: "sink_b", kind: "sink", componentType: "s3", inputs: ["src_b"] }),
    ];

    const result = detectSubgraphs(components);

    expect(result.subgraphs).toHaveLength(2);
    // Each subgraph should have exactly 2 components
    expect(result.subgraphs[0].components).toHaveLength(2);
    expect(result.subgraphs[1].components).toHaveLength(2);
  });

  it("keeps shared transforms in one subgraph", () => {
    const components: ParsedComponent[] = [
      makeComponent({ componentKey: "src_a", kind: "source", componentType: "kafka" }),
      makeComponent({ componentKey: "src_b", kind: "source", componentType: "file" }),
      makeComponent({
        componentKey: "shared_transform",
        kind: "transform",
        componentType: "remap",
        inputs: ["src_a", "src_b"],
      }),
      makeComponent({ componentKey: "sink_out", kind: "sink", componentType: "http", inputs: ["shared_transform"] }),
    ];

    const result = detectSubgraphs(components);

    expect(result.subgraphs).toHaveLength(1);
    expect(result.subgraphs[0].components).toHaveLength(4);
  });

  it("handles a fully connected config as one subgraph", () => {
    const components: ParsedComponent[] = [
      makeComponent({ componentKey: "src", kind: "source", componentType: "stdin" }),
      makeComponent({ componentKey: "transform1", kind: "transform", componentType: "remap", inputs: ["src"] }),
      makeComponent({ componentKey: "transform2", kind: "transform", componentType: "filter", inputs: ["transform1"] }),
      makeComponent({ componentKey: "sink", kind: "sink", componentType: "console", inputs: ["transform2"] }),
    ];

    const result = detectSubgraphs(components);

    expect(result.subgraphs).toHaveLength(1);
    expect(result.subgraphs[0].components).toHaveLength(4);
  });

  it("auto-generates names from source-to-sink types", () => {
    const components: ParsedComponent[] = [
      makeComponent({ componentKey: "my_kafka", kind: "source", componentType: "kafka" }),
      makeComponent({ componentKey: "my_sink", kind: "sink", componentType: "http", inputs: ["my_kafka"] }),
    ];

    const result = detectSubgraphs(components);

    expect(result.subgraphs).toHaveLength(1);
    expect(result.subgraphs[0].suggestedName).toBe("kafka-to-http");
  });

  it("replaces underscores with hyphens in auto-generated names", () => {
    const components: ParsedComponent[] = [
      makeComponent({ componentKey: "src", kind: "source", componentType: "demo_logs" }),
      makeComponent({ componentKey: "snk", kind: "sink", componentType: "aws_s3", inputs: ["src"] }),
    ];

    const result = detectSubgraphs(components);

    expect(result.subgraphs[0].suggestedName).toBe("demo-logs-to-aws-s3");
  });

  it("handles a single orphan component as its own subgraph", () => {
    const components: ParsedComponent[] = [
      makeComponent({ componentKey: "lonely_source", kind: "source", componentType: "stdin" }),
    ];

    const result = detectSubgraphs(components);

    expect(result.subgraphs).toHaveLength(1);
    expect(result.subgraphs[0].components).toHaveLength(1);
    expect(result.subgraphs[0].components[0].componentKey).toBe("lonely_source");
  });

  it("uses filename (without extension) as name for single subgraph when filename is provided", () => {
    const components: ParsedComponent[] = [
      makeComponent({ componentKey: "src", kind: "source", componentType: "kafka" }),
      makeComponent({ componentKey: "snk", kind: "sink", componentType: "http", inputs: ["src"] }),
    ];

    const result = detectSubgraphs(components, "my-pipeline.yaml");

    expect(result.subgraphs).toHaveLength(1);
    expect(result.subgraphs[0].suggestedName).toBe("my-pipeline");
  });

  it("does NOT use filename when there are multiple subgraphs", () => {
    const components: ParsedComponent[] = [
      makeComponent({ componentKey: "src_a", kind: "source", componentType: "kafka" }),
      makeComponent({ componentKey: "snk_a", kind: "sink", componentType: "http", inputs: ["src_a"] }),
      makeComponent({ componentKey: "src_b", kind: "source", componentType: "file" }),
      makeComponent({ componentKey: "snk_b", kind: "sink", componentType: "s3", inputs: ["src_b"] }),
    ];

    const result = detectSubgraphs(components, "multi.yaml");

    expect(result.subgraphs).toHaveLength(2);
    // Names should be auto-generated, not "multi"
    for (const sg of result.subgraphs) {
      expect(sg.suggestedName).not.toBe("multi");
    }
  });

  it("sorts subgraphs by component count descending", () => {
    const components: ParsedComponent[] = [
      // Small pipeline: 2 components
      makeComponent({ componentKey: "src_a", kind: "source", componentType: "file" }),
      makeComponent({ componentKey: "snk_a", kind: "sink", componentType: "s3", inputs: ["src_a"] }),
      // Large pipeline: 3 components
      makeComponent({ componentKey: "src_b", kind: "source", componentType: "kafka" }),
      makeComponent({ componentKey: "t_b", kind: "transform", componentType: "remap", inputs: ["src_b"] }),
      makeComponent({ componentKey: "snk_b", kind: "sink", componentType: "http", inputs: ["t_b"] }),
    ];

    const result = detectSubgraphs(components);

    expect(result.subgraphs).toHaveLength(2);
    expect(result.subgraphs[0].components).toHaveLength(3);
    expect(result.subgraphs[1].components).toHaveLength(2);
  });

  it("returns empty subgraphs array for empty input", () => {
    const result = detectSubgraphs([]);
    expect(result.subgraphs).toHaveLength(0);
  });
});
