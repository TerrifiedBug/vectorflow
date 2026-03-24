import { describe, it, expect } from "vitest";
import type { AiSuggestion } from "../types";
import { detectConflicts } from "../conflict-detector";

// ─── Helpers ────────────────────────────────────────────────────────────────

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

describe("detectConflicts", () => {
  it("detects overlapping modify_config on same component", () => {
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", { type: "modify_config", componentKey: "comp1", changes: { port: 8080 } }),
      baseSuggestion("s2", { type: "modify_config", componentKey: "comp1", changes: { port: 9090 } }),
    ];
    const conflicts = detectConflicts(suggestions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toContain("port");
  });

  it("returns no conflict for modify_config on different components", () => {
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", { type: "modify_config", componentKey: "comp1", changes: { port: 8080 } }),
      baseSuggestion("s2", { type: "modify_config", componentKey: "comp2", changes: { port: 9090 } }),
    ];
    const conflicts = detectConflicts(suggestions);
    expect(conflicts).toHaveLength(0);
  });

  it("detects contradicting modify_connections (add + remove same edge)", () => {
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", {
        type: "modify_connections",
        edgeChanges: [{ action: "add", from: "a", to: "b" }],
      }),
      baseSuggestion("s2", {
        type: "modify_connections",
        edgeChanges: [{ action: "remove", from: "a", to: "b" }],
      }),
    ];
    const conflicts = detectConflicts(suggestions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toContain("Contradicting");
  });

  it("detects duplicate edge addition", () => {
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", {
        type: "modify_connections",
        edgeChanges: [{ action: "add", from: "a", to: "b" }],
      }),
      baseSuggestion("s2", {
        type: "modify_connections",
        edgeChanges: [{ action: "add", from: "a", to: "b" }],
      }),
    ];
    const conflicts = detectConflicts(suggestions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toContain("Duplicate");
  });

  it("detects remove_component + reference by another suggestion", () => {
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", { type: "remove_component", componentKey: "comp1", reconnect: false }),
      baseSuggestion("s2", { type: "modify_config", componentKey: "comp1", changes: { port: 8080 } }),
    ];
    const conflicts = detectConflicts(suggestions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toContain("removed");
  });

  it("detects add_component connectTo vs modify_connections removing edge to same target", () => {
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", {
        type: "add_component",
        component: { key: "new", componentType: "filter", kind: "transform", config: {} },
        insertAfter: "src1",
        connectTo: ["sink1"],
      }),
      baseSuggestion("s2", {
        type: "modify_connections",
        edgeChanges: [{ action: "remove", from: "src1", to: "sink1" }],
      }),
    ];
    const conflicts = detectConflicts(suggestions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toContain("sink1");
  });

  it("returns empty array for non-conflicting suggestions", () => {
    const suggestions: AiSuggestion[] = [
      baseSuggestion("s1", { type: "modify_config", componentKey: "comp1", changes: { port: 8080 } }),
      baseSuggestion("s2", { type: "modify_config", componentKey: "comp1", changes: { host: "localhost" } }),
    ];
    const conflicts = detectConflicts(suggestions);
    expect(conflicts).toHaveLength(0);
  });
});
