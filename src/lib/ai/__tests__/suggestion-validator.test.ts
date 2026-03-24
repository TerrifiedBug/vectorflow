import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import type { AiSuggestion } from "../types";
import {
  parseAiReviewResponse,
  validateSuggestions,
  detectOutdatedSuggestions,
} from "../suggestion-validator";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeNode(id: string, componentKey: string): Node {
  return {
    id,
    type: "transform",
    position: { x: 0, y: 0 },
    data: { componentKey },
  };
}

function baseSuggestion(id: string, overrides: Partial<AiSuggestion> & { type: string }): AiSuggestion {
  return {
    id,
    title: `Suggestion ${id}`,
    description: "Test",
    priority: "medium",
    ...overrides,
  } as AiSuggestion;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("parseAiReviewResponse", () => {
  it("parses valid JSON", () => {
    const raw = JSON.stringify({ summary: "Looks good", suggestions: [] });
    const result = parseAiReviewResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Looks good");
    expect(result!.suggestions).toEqual([]);
  });

  it("parses JSON wrapped in code fences", () => {
    const raw = '```json\n{"summary":"OK","suggestions":[]}\n```';
    const result = parseAiReviewResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("OK");
  });

  it("returns null for malformed JSON", () => {
    expect(parseAiReviewResponse("not json at all")).toBeNull();
  });

  it("returns null when summary is missing", () => {
    const raw = JSON.stringify({ suggestions: [] });
    expect(parseAiReviewResponse(raw)).toBeNull();
  });

  it("returns null when suggestions array is missing", () => {
    const raw = JSON.stringify({ summary: "No suggestions field" });
    expect(parseAiReviewResponse(raw)).toBeNull();
  });
});

describe("validateSuggestions", () => {
  it("returns 'actionable' for suggestion referencing existing componentKey", () => {
    const nodes = [makeNode("n1", "comp1")];
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", { type: "modify_config", componentKey: "comp1", changes: { port: 8080 } }),
    ];
    const statuses = validateSuggestions(suggestions, nodes);
    expect(statuses.get("s1")).toBe("actionable");
  });

  it("returns 'invalid' for suggestion referencing missing componentKey", () => {
    const nodes = [makeNode("n1", "comp1")];
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", { type: "modify_config", componentKey: "missing", changes: { port: 8080 } }),
    ];
    const statuses = validateSuggestions(suggestions, nodes);
    expect(statuses.get("s1")).toBe("invalid");
  });

  it("returns 'invalid' for add_component with missing insertAfter", () => {
    const nodes = [makeNode("n1", "comp1")];
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", {
        type: "add_component",
        component: { key: "x", componentType: "filter", kind: "transform", config: {} },
        insertAfter: "nonexistent",
        connectTo: ["comp1"],
      }),
    ];
    const statuses = validateSuggestions(suggestions, nodes);
    expect(statuses.get("s1")).toBe("invalid");
  });
});

describe("detectOutdatedSuggestions", () => {
  const yamlTemplate = (compBlock: string) =>
    `sources:\n  comp1:\n    type: demo_logs\n    ${compBlock}\ntransforms:\n  comp2:\n    type: remap\n    source: ".x = 1"\n`;

  it("returns empty set when no snapshot", () => {
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", { type: "modify_config", componentKey: "comp1", changes: {} }),
    ];
    const result = detectOutdatedSuggestions(suggestions, null, "any yaml");
    expect(result.size).toBe(0);
  });

  it("returns empty set when same YAML", () => {
    const yaml = yamlTemplate("format: json");
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", { type: "modify_config", componentKey: "comp1", changes: {} }),
    ];
    const result = detectOutdatedSuggestions(suggestions, yaml, yaml);
    expect(result.size).toBe(0);
  });

  it("marks suggestion as outdated when its component block changed", () => {
    const snapshotYaml = yamlTemplate("format: json");
    const currentYaml = yamlTemplate("format: syslog");
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", { type: "modify_config", componentKey: "comp1", changes: {} }),
    ];
    const result = detectOutdatedSuggestions(suggestions, snapshotYaml, currentYaml);
    expect(result.has("s1")).toBe(true);
  });

  it("does not mark suggestion as outdated when unrelated component changed", () => {
    const snapshotYaml = `sources:\n  comp1:\n    type: demo_logs\ntransforms:\n  comp2:\n    type: remap\n    source: ".x = 1"\n`;
    const currentYaml = `sources:\n  comp1:\n    type: demo_logs\ntransforms:\n  comp2:\n    type: remap\n    source: ".x = 2"\n`;
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", { type: "modify_config", componentKey: "comp1", changes: {} }),
    ];
    const result = detectOutdatedSuggestions(suggestions, snapshotYaml, currentYaml);
    expect(result.has("s1")).toBe(false);
  });
});
