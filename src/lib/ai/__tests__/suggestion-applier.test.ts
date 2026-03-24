import { describe, it, expect, vi } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import type { AiSuggestion } from "../types";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/vector/catalog", () => ({
  findComponentDef: vi.fn(),
}));

vi.mock("@/lib/component-key", () => ({
  generateComponentKey: vi.fn(() => "mock-component-key"),
}));

vi.mock("@/lib/utils", () => ({
  generateId: vi.fn(() => "mock-id"),
}));

import { findComponentDef } from "@/lib/vector/catalog";
import { applySuggestion } from "../suggestion-applier";

// ─── Helpers ────────────────────────────────────────────────────────────────

const mockedFindComponentDef = vi.mocked(findComponentDef);

function makeNode(id: string, componentKey: string, config: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Node {
  return {
    id,
    type: "transform",
    position: { x: 0, y: 0 },
    data: { componentKey, config, ...extra },
  };
}

function makeEdge(source: string, target: string, id = `e-${source}-${target}`): Edge {
  return { id, source, target };
}

function baseSuggestion(overrides: Partial<AiSuggestion> & { type: string }): AiSuggestion {
  return {
    id: "s1",
    title: "Test suggestion",
    description: "For testing",
    priority: "medium",
    ...overrides,
  } as AiSuggestion;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("applySuggestion", () => {
  describe("modify_config", () => {
    it("updates a top-level config field", () => {
      const nodes = [makeNode("n1", "src1", { port: 8080 })];
      const result = applySuggestion(
        baseSuggestion({ type: "modify_config", componentKey: "src1", changes: { port: 9090 } }),
        nodes,
        [],
      );
      expect(result.error).toBeUndefined();
      const config = (result.nodes[0].data as Record<string, unknown>).config as Record<string, unknown>;
      expect(config.port).toBe(9090);
    });

    it("updates a nested dot-path config field", () => {
      const nodes = [makeNode("n1", "src1", { tls: { enabled: false } })];
      const result = applySuggestion(
        baseSuggestion({ type: "modify_config", componentKey: "src1", changes: { "tls.enabled": true } }),
        nodes,
        [],
      );
      expect(result.error).toBeUndefined();
      const config = (result.nodes[0].data as Record<string, unknown>).config as Record<string, unknown>;
      expect((config.tls as Record<string, unknown>).enabled).toBe(true);
    });

    it("returns error for missing componentKey", () => {
      const result = applySuggestion(
        baseSuggestion({ type: "modify_config", componentKey: "missing", changes: { port: 9090 } }),
        [],
        [],
      );
      expect(result.error).toContain("not found");
    });
  });

  describe("add_component", () => {
    it("adds a node after an existing one, creates edges, rewires downstream", () => {
      mockedFindComponentDef.mockReturnValue({ displayName: "Filter" } as ReturnType<typeof findComponentDef>);
      const nodes = [makeNode("n1", "src1"), makeNode("n2", "sink1")];
      const edges = [makeEdge("n1", "n2")];

      const result = applySuggestion(
        baseSuggestion({
          type: "add_component",
          component: { key: "filter1", componentType: "filter", kind: "transform", config: {} },
          insertAfter: "src1",
          connectTo: ["sink1"],
        }),
        nodes,
        edges,
      );

      expect(result.error).toBeUndefined();
      expect(result.nodes).toHaveLength(3);
      // New node exists with the mock component key
      const newNode = result.nodes[2];
      expect((newNode.data as Record<string, unknown>).componentKey).toBe("mock-component-key");
      // Edges: src1→new, new→sink1 (old src1→sink1 removed)
      expect(result.edges.some((e) => e.source === "n1" && e.target === "mock-id")).toBe(true);
      expect(result.edges.some((e) => e.source === "mock-id" && e.target === "n2")).toBe(true);
      expect(result.edges.some((e) => e.source === "n1" && e.target === "n2")).toBe(false);
    });

    it("returns error for unknown componentType", () => {
      mockedFindComponentDef.mockReturnValue(undefined as unknown as ReturnType<typeof findComponentDef>);
      const nodes = [makeNode("n1", "src1")];

      const result = applySuggestion(
        baseSuggestion({
          type: "add_component",
          component: { key: "x", componentType: "unknown", kind: "transform", config: {} },
          insertAfter: "src1",
          connectTo: [],
        }),
        nodes,
        [],
      );
      expect(result.error).toContain("Unknown component type");
    });

    it("returns error for missing insertAfter component", () => {
      mockedFindComponentDef.mockReturnValue({ displayName: "X" } as ReturnType<typeof findComponentDef>);
      const result = applySuggestion(
        baseSuggestion({
          type: "add_component",
          component: { key: "x", componentType: "filter", kind: "transform", config: {} },
          insertAfter: "missing",
          connectTo: [],
        }),
        [],
        [],
      );
      expect(result.error).toContain("not found for insertAfter");
    });
  });

  describe("remove_component", () => {
    it("removes a node and its edges", () => {
      const nodes = [makeNode("n1", "src1"), makeNode("n2", "filter1"), makeNode("n3", "sink1")];
      const edges = [makeEdge("n1", "n2"), makeEdge("n2", "n3")];

      const result = applySuggestion(
        baseSuggestion({ type: "remove_component", componentKey: "filter1", reconnect: false }),
        nodes,
        edges,
      );

      expect(result.error).toBeUndefined();
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(0);
    });

    it("rewires connections when reconnect is true", () => {
      const nodes = [makeNode("n1", "src1"), makeNode("n2", "filter1"), makeNode("n3", "sink1")];
      const edges = [makeEdge("n1", "n2"), makeEdge("n2", "n3")];

      const result = applySuggestion(
        baseSuggestion({ type: "remove_component", componentKey: "filter1", reconnect: true }),
        nodes,
        edges,
      );

      expect(result.error).toBeUndefined();
      expect(result.nodes).toHaveLength(2);
      // Should have a reconnect edge from n1 → n3
      expect(result.edges.some((e) => e.source === "n1" && e.target === "n3")).toBe(true);
    });

    it("returns error for missing component", () => {
      const result = applySuggestion(
        baseSuggestion({ type: "remove_component", componentKey: "missing", reconnect: false }),
        [],
        [],
      );
      expect(result.error).toContain("not found");
    });

    it("returns error for system-locked node", () => {
      const nodes = [makeNode("n1", "locked1", {}, { isSystemLocked: true })];
      const result = applySuggestion(
        baseSuggestion({ type: "remove_component", componentKey: "locked1", reconnect: false }),
        nodes,
        [],
      );
      expect(result.error).toContain("system-locked");
    });
  });

  describe("modify_connections", () => {
    it("adds an edge between components", () => {
      const nodes = [makeNode("n1", "src1"), makeNode("n2", "sink1")];
      const result = applySuggestion(
        baseSuggestion({
          type: "modify_connections",
          edgeChanges: [{ action: "add", from: "src1", to: "sink1" }],
        }),
        nodes,
        [],
      );
      expect(result.error).toBeUndefined();
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe("n1");
      expect(result.edges[0].target).toBe("n2");
    });

    it("removes an edge between components", () => {
      const nodes = [makeNode("n1", "src1"), makeNode("n2", "sink1")];
      const edges = [makeEdge("n1", "n2")];
      const result = applySuggestion(
        baseSuggestion({
          type: "modify_connections",
          edgeChanges: [{ action: "remove", from: "src1", to: "sink1" }],
        }),
        nodes,
        edges,
      );
      expect(result.error).toBeUndefined();
      expect(result.edges).toHaveLength(0);
    });

    it("returns error for missing component keys", () => {
      const result = applySuggestion(
        baseSuggestion({
          type: "modify_connections",
          edgeChanges: [{ action: "add", from: "missing", to: "also_missing" }],
        }),
        [],
        [],
      );
      expect(result.error).toContain("not found");
    });
  });

  describe("modify_vrl", () => {
    it("replaces VRL code at the target config path", () => {
      const nodes = [makeNode("n1", "remap1", { source: '.message = "hello"\n.tag = "old"' })];
      const result = applySuggestion(
        baseSuggestion({
          type: "modify_vrl",
          componentKey: "remap1",
          configPath: "source",
          targetCode: '.tag = "old"',
          code: '.tag = "new"',
        }),
        nodes,
        [],
      );
      expect(result.error).toBeUndefined();
      const config = (result.nodes[0].data as Record<string, unknown>).config as Record<string, unknown>;
      expect(config.source).toBe('.message = "hello"\n.tag = "new"');
    });

    it("returns error when targetCode not found", () => {
      const nodes = [makeNode("n1", "remap1", { source: '.message = "hello"' })];
      const result = applySuggestion(
        baseSuggestion({
          type: "modify_vrl",
          componentKey: "remap1",
          configPath: "source",
          targetCode: ".nonexistent = true",
          code: ".replaced = true",
        }),
        nodes,
        [],
      );
      expect(result.error).toContain("Target code not found");
    });

    it("returns error when configPath is not a string", () => {
      const nodes = [makeNode("n1", "remap1", { source: 42 })];
      const result = applySuggestion(
        baseSuggestion({
          type: "modify_vrl",
          componentKey: "remap1",
          configPath: "source",
          targetCode: "anything",
          code: "replacement",
        }),
        nodes,
        [],
      );
      expect(result.error).toContain("not a string value");
    });

    it("returns error for missing component", () => {
      const result = applySuggestion(
        baseSuggestion({
          type: "modify_vrl",
          componentKey: "missing",
          configPath: "source",
          targetCode: "x",
          code: "y",
        }),
        [],
        [],
      );
      expect(result.error).toContain("not found");
    });
  });
});
