import { describe, it, expect } from "vitest";
import {
  buildSuggestionSchemaBlock,
  buildVrlReferenceBlock,
  buildPipelineNodeContext,
} from "@/lib/ai/shared-prompt-context";

describe("buildSuggestionSchemaBlock", () => {
  it("returns pipeline suggestion JSON schema when mode is pipeline", () => {
    const result = buildSuggestionSchemaBlock("pipeline");
    expect(result).toContain("modify_vrl");
    expect(result).toContain("add_component");
    expect(result).toContain("remove_component");
    expect(result).toContain("modify_config");
    expect(result).toContain("targetCode");
  });

  it("returns VRL suggestion JSON schema when mode is vrl", () => {
    const result = buildSuggestionSchemaBlock("vrl");
    expect(result).toContain("insert_code");
    expect(result).toContain("replace_code");
    expect(result).toContain("remove_code");
  });
});

describe("buildVrlReferenceBlock", () => {
  it("returns non-empty VRL function reference", () => {
    const result = buildVrlReferenceBlock();
    expect(result.length).toBeGreaterThan(100);
    expect(result).toContain("VRL Function Reference");
  });
});

describe("buildPipelineNodeContext", () => {
  it("formats pipeline nodes with component keys and VRL code", () => {
    const nodes = [
      { componentKey: "parse_logs", componentType: "remap", kind: "TRANSFORM", config: { source: ".message = downcase(.message)" } },
      { componentKey: "output", componentType: "console", kind: "SINK", config: { encoding: { codec: "json" } } },
    ];
    const result = buildPipelineNodeContext(nodes);
    expect(result).toContain("parse_logs");
    expect(result).toContain("remap");
    expect(result).toContain("downcase");
    expect(result).toContain("output");
  });

  it("returns fallback when no nodes provided", () => {
    const result = buildPipelineNodeContext([]);
    expect(result).toContain("No pipeline nodes");
  });
});
