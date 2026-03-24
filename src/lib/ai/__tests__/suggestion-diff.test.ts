import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import type { AiSuggestion } from "../types";
import { computeSuggestionDiff, type DiffResult } from "../suggestion-diff";

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

describe("computeSuggestionDiff", () => {
  describe("modify_config", () => {
    it("returns json diff with correct before/after for a single field change", () => {
      const nodes = [makeNode("n1", "src1", { port: 8080 })];
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "modify_config",
          componentKey: "src1",
          changes: { port: 9090 },
        }),
        nodes,
      );

      expect(result).not.toBeNull();
      expect(result!.type).toBe("json");
      const jsonResult = result as Extract<DiffResult, { type: "json" }>;
      expect(jsonResult.changes).toHaveLength(1);
      expect(jsonResult.changes[0]).toEqual({
        key: "port",
        before: 8080,
        after: 9090,
      });
    });

    it("resolves nested dot-path correctly", () => {
      const nodes = [makeNode("n1", "src1", { tls: { enabled: false, cert: "/old" } })];
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "modify_config",
          componentKey: "src1",
          changes: { "tls.enabled": true },
        }),
        nodes,
      );

      expect(result).not.toBeNull();
      const jsonResult = result as Extract<DiffResult, { type: "json" }>;
      expect(jsonResult.changes).toHaveLength(1);
      expect(jsonResult.changes[0]).toEqual({
        key: "tls.enabled",
        before: false,
        after: true,
      });
    });

    it("includes all changes when multiple keys are modified", () => {
      const nodes = [makeNode("n1", "src1", { port: 8080, host: "0.0.0.0" })];
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "modify_config",
          componentKey: "src1",
          changes: { port: 9090, host: "127.0.0.1" },
        }),
        nodes,
      );

      expect(result).not.toBeNull();
      const jsonResult = result as Extract<DiffResult, { type: "json" }>;
      expect(jsonResult.changes).toHaveLength(2);
      expect(jsonResult.changes).toEqual(
        expect.arrayContaining([
          { key: "port", before: 8080, after: 9090 },
          { key: "host", before: "0.0.0.0", after: "127.0.0.1" },
        ]),
      );
    });

    it("returns null when component is not found", () => {
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "modify_config",
          componentKey: "missing",
          changes: { port: 9090 },
        }),
        [],
      );
      expect(result).toBeNull();
    });
  });

  describe("modify_vrl", () => {
    it("returns lines diff for a simple replacement", () => {
      const nodes = [
        makeNode("n1", "remap1", {
          source: '.message = "hello"\n.tag = "old"\n',
        }),
      ];
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "modify_vrl",
          componentKey: "remap1",
          configPath: "source",
          targetCode: '.tag = "old"',
          code: '.tag = "new"',
        }),
        nodes,
      );

      expect(result).not.toBeNull();
      expect(result!.type).toBe("lines");
      const linesResult = result as Extract<DiffResult, { type: "lines" }>;
      expect(linesResult.hunks.length).toBeGreaterThan(0);

      // Should have at least one removed and one added hunk
      const hasRemoved = linesResult.hunks.some((h) => h.removed);
      const hasAdded = linesResult.hunks.some((h) => h.added);
      expect(hasRemoved).toBe(true);
      expect(hasAdded).toBe(true);
    });

    it("produces correct line-level diff for multi-line VRL", () => {
      const originalVrl = [
        ".message = downcase(.message)",
        'if exists(.host) {',
        '  .hostname = del(.host)',
        "}",
        ".timestamp = now()",
      ].join("\n");

      const nodes = [makeNode("n1", "remap1", { source: originalVrl })];

      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "modify_vrl",
          componentKey: "remap1",
          configPath: "source",
          targetCode: "  .hostname = del(.host)",
          code: "  .hostname = to_string(.host)\n  del(.host)",
        }),
        nodes,
      );

      expect(result).not.toBeNull();
      const linesResult = result as Extract<DiffResult, { type: "lines" }>;
      expect(linesResult.type).toBe("lines");
      // Verify the diff contains the expected old/new lines
      const removedText = linesResult.hunks
        .filter((h) => h.removed)
        .map((h) => h.value)
        .join("");
      const addedText = linesResult.hunks
        .filter((h) => h.added)
        .map((h) => h.value)
        .join("");
      expect(removedText).toContain(".hostname = del(.host)");
      expect(addedText).toContain(".hostname = to_string(.host)");
      expect(addedText).toContain("del(.host)");
    });

    it("returns null when targetCode is not found in current value", () => {
      const nodes = [
        makeNode("n1", "remap1", { source: '.message = "hello"' }),
      ];
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "modify_vrl",
          componentKey: "remap1",
          configPath: "source",
          targetCode: ".nonexistent = true",
          code: ".replaced = true",
        }),
        nodes,
      );
      expect(result).toBeNull();
    });

    it("returns null when component is not found", () => {
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "modify_vrl",
          componentKey: "missing",
          configPath: "source",
          targetCode: "x",
          code: "y",
        }),
        [],
      );
      expect(result).toBeNull();
    });

    it("returns null when configPath resolves to non-string", () => {
      const nodes = [makeNode("n1", "remap1", { source: 42 })];
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "modify_vrl",
          componentKey: "remap1",
          configPath: "source",
          targetCode: "anything",
          code: "replacement",
        }),
        nodes,
      );
      expect(result).toBeNull();
    });
  });

  describe("structural suggestion types", () => {
    it("returns null for add_component", () => {
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "add_component",
          component: {
            key: "filter1",
            componentType: "filter",
            kind: "transform" as const,
            config: {},
          },
          insertAfter: "src1",
          connectTo: ["sink1"],
        }),
        [],
      );
      expect(result).toBeNull();
    });

    it("returns null for remove_component", () => {
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "remove_component",
          componentKey: "filter1",
          reconnect: true,
        }),
        [],
      );
      expect(result).toBeNull();
    });

    it("returns null for modify_connections", () => {
      const result = computeSuggestionDiff(
        baseSuggestion({
          type: "modify_connections",
          edgeChanges: [{ action: "add" as const, from: "src1", to: "sink1" }],
        }),
        [],
      );
      expect(result).toBeNull();
    });
  });
});
