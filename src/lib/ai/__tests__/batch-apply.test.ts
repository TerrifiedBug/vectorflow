import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import type { AiSuggestion } from "../types";

// ─── Mocks (same deps as suggestion-applier.test.ts + xyflow) ───────────────

vi.mock("@/lib/vector/catalog", () => ({
  findComponentDef: vi.fn(),
}));

vi.mock("@/lib/component-key", () => ({
  generateComponentKey: vi.fn(() => "mock-component-key"),
}));

vi.mock("@/lib/utils", () => ({
  generateId: vi.fn(() => "mock-id"),
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// ─── Import store after mocks ──────────────────────────────────────────────

import { useFlowStore } from "@/stores/flow-store";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  componentKey: string,
  config: Record<string, unknown> = {},
): Node {
  return {
    id,
    type: "transform",
    position: { x: 0, y: 0 },
    data: { componentKey, config },
  };
}

function makeEdge(
  source: string,
  target: string,
  id = `e-${source}-${target}`,
): Edge {
  return { id, source, target };
}

function baseSuggestion(
  overrides: Partial<AiSuggestion> & { type: string },
): AiSuggestion {
  return {
    id: "s1",
    title: "Test suggestion",
    description: "For testing",
    priority: "medium",
    ...overrides,
  } as AiSuggestion;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("applySuggestions (batch)", () => {
  beforeEach(() => {
    // Reset the store to a clean state before each test
    useFlowStore.getState().clearGraph();
  });

  it("returns per-suggestion success results for all valid suggestions", () => {
    const nodes = [
      makeNode("n1", "src1", { port: 8080 }),
      makeNode("n2", "sink1", { endpoint: "http://old" }),
    ];
    useFlowStore.getState().loadGraph(nodes, []);

    const suggestions: AiSuggestion[] = [
      baseSuggestion({
        id: "s1",
        type: "modify_config",
        componentKey: "src1",
        changes: { port: 9090 },
      }),
      baseSuggestion({
        id: "s2",
        type: "modify_config",
        componentKey: "sink1",
        changes: { endpoint: "http://new" },
      }),
    ];

    const { results } = useFlowStore.getState().applySuggestions(suggestions);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ suggestionId: "s1", success: true });
    expect(results[1]).toEqual({ suggestionId: "s2", success: true });

    // Verify canUndo is true — a snapshot was pushed
    expect(useFlowStore.getState().canUndo).toBe(true);
  });

  it("returns mixed results when some suggestions target missing components", () => {
    const nodes = [makeNode("n1", "src1", { port: 8080 })];
    useFlowStore.getState().loadGraph(nodes, []);

    const suggestions: AiSuggestion[] = [
      baseSuggestion({
        id: "s1",
        type: "modify_config",
        componentKey: "src1",
        changes: { port: 9090 },
      }),
      baseSuggestion({
        id: "s2",
        type: "modify_config",
        componentKey: "missing-component",
        changes: { port: 1234 },
      }),
    ];

    const { results } = useFlowStore.getState().applySuggestions(suggestions);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ suggestionId: "s1", success: true });
    expect(results[1]).toMatchObject({
      suggestionId: "s2",
      success: false,
    });
    expect(results[1].error).toBeDefined();
    expect(typeof results[1].error).toBe("string");

    // One succeeded, so canUndo should be true
    expect(useFlowStore.getState().canUndo).toBe(true);
  });

  it("does not push a snapshot when all suggestions fail", () => {
    const nodes = [makeNode("n1", "src1", { port: 8080 })];
    useFlowStore.getState().loadGraph(nodes, []);

    const suggestions: AiSuggestion[] = [
      baseSuggestion({
        id: "s1",
        type: "modify_config",
        componentKey: "missing1",
        changes: { port: 9090 },
      }),
      baseSuggestion({
        id: "s2",
        type: "modify_config",
        componentKey: "missing2",
        changes: { port: 1234 },
      }),
    ];

    const { results } = useFlowStore.getState().applySuggestions(suggestions);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success === false)).toBe(true);
    expect(results[0].error).toBeDefined();
    expect(results[1].error).toBeDefined();

    // No snapshot pushed — canUndo remains false
    expect(useFlowStore.getState().canUndo).toBe(false);
  });

  it("returns an empty results array for an empty suggestions array", () => {
    useFlowStore.getState().loadGraph([], []);

    const { results } = useFlowStore.getState().applySuggestions([]);

    expect(results).toEqual([]);
    expect(useFlowStore.getState().canUndo).toBe(false);
  });

  it("carries forward node/edge mutations from earlier suggestions to later ones", () => {
    // This verifies that the second suggestion sees the result of the first
    const nodes = [makeNode("n1", "src1", { port: 8080, host: "old" })];
    useFlowStore.getState().loadGraph(nodes, []);

    const suggestions: AiSuggestion[] = [
      baseSuggestion({
        id: "s1",
        type: "modify_config",
        componentKey: "src1",
        changes: { port: 9090 },
      }),
      baseSuggestion({
        id: "s2",
        type: "modify_config",
        componentKey: "src1",
        changes: { host: "new" },
      }),
    ];

    const { results } = useFlowStore.getState().applySuggestions(suggestions);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);

    // Both changes should be applied to the same node
    const finalNode = useFlowStore.getState().nodes[0];
    const config = (finalNode.data as Record<string, unknown>).config as Record<string, unknown>;
    expect(config.port).toBe(9090);
    expect(config.host).toBe("new");
  });
});
