import { describe, it, expect } from "vitest";
import {
  computeComponentDiff,
  type NodeSnapshot,
  type EdgeSnapshot,
} from "../version-diff";

// ── Test helpers ─────────────────────────────────────────────────────

/** Create a minimal valid NodeSnapshot with overrides. */
function makeNode(overrides: Partial<NodeSnapshot> & { componentKey: string }): NodeSnapshot {
  return {
    id: overrides.id ?? `id-${overrides.componentKey}`,
    componentKey: overrides.componentKey,
    displayName: overrides.displayName ?? overrides.componentKey,
    componentType: overrides.componentType ?? "source",
    kind: overrides.kind ?? "HTTP",
    config: overrides.config ?? {},
    positionX: overrides.positionX ?? 0,
    positionY: overrides.positionY ?? 0,
    disabled: overrides.disabled ?? false,
  };
}

/** Create a minimal valid EdgeSnapshot with overrides. */
function makeEdge(
  overrides: Partial<EdgeSnapshot> & { sourceNodeId: string; targetNodeId: string },
): EdgeSnapshot {
  return {
    id: overrides.id ?? `edge-${overrides.sourceNodeId}-${overrides.targetNodeId}`,
    sourceNodeId: overrides.sourceNodeId,
    targetNodeId: overrides.targetNodeId,
    sourcePort: overrides.sourcePort ?? "default",
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("computeComponentDiff", () => {
  // ── Added nodes ────────────────────────────────────────────────────
  describe("added nodes", () => {
    it("detects a node present in new but not in old", () => {
      const newNode = makeNode({ componentKey: "src-1" });
      const result = computeComponentDiff([], [newNode], [], []);

      expect(result.added).toHaveLength(1);
      expect(result.added[0]!.componentKey).toBe("src-1");
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
    });
  });

  // ── Removed nodes ──────────────────────────────────────────────────
  describe("removed nodes", () => {
    it("detects a node present in old but not in new", () => {
      const oldNode = makeNode({ componentKey: "src-1" });
      const result = computeComponentDiff([oldNode], [], [], []);

      expect(result.removed).toHaveLength(1);
      expect(result.removed[0]!.componentKey).toBe("src-1");
      expect(result.added).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
    });
  });

  // ── Modified nodes — config change ─────────────────────────────────
  describe("modified nodes (config change)", () => {
    it("detects config change and populates configChanges", () => {
      const oldNode = makeNode({
        componentKey: "src-1",
        config: { url: "http://old.example.com", batch_size: 100 },
      });
      const newNode = makeNode({
        componentKey: "src-1",
        config: { url: "http://new.example.com", batch_size: 100 },
      });

      const result = computeComponentDiff([oldNode], [newNode], [], []);

      expect(result.modified).toHaveLength(1);
      expect(result.modified[0]!.node.componentKey).toBe("src-1");
      expect(result.modified[0]!.oldNode.config).toEqual(oldNode.config);
      expect(result.modified[0]!.configChanges.length).toBeGreaterThan(0);
      expect(result.unchanged).toHaveLength(0);
    });
  });

  // ── Modified nodes — kind/type/disabled change ─────────────────────
  describe("modified nodes (kind/type/disabled change)", () => {
    it("detects kind change as modified", () => {
      const oldNode = makeNode({ componentKey: "src-1", kind: "HTTP" });
      const newNode = makeNode({ componentKey: "src-1", kind: "GRPC" });

      const result = computeComponentDiff([oldNode], [newNode], [], []);
      expect(result.modified).toHaveLength(1);
      expect(result.unchanged).toHaveLength(0);
    });

    it("detects componentType change as modified", () => {
      const oldNode = makeNode({ componentKey: "src-1", componentType: "source" });
      const newNode = makeNode({ componentKey: "src-1", componentType: "transform" });

      const result = computeComponentDiff([oldNode], [newNode], [], []);
      expect(result.modified).toHaveLength(1);
    });

    it("detects disabled change as modified", () => {
      const oldNode = makeNode({ componentKey: "src-1", disabled: false });
      const newNode = makeNode({ componentKey: "src-1", disabled: true });

      const result = computeComponentDiff([oldNode], [newNode], [], []);
      expect(result.modified).toHaveLength(1);
    });
  });

  // ── Unchanged nodes ────────────────────────────────────────────────
  describe("unchanged nodes", () => {
    it("classifies identical semantic fields as unchanged", () => {
      const node = makeNode({ componentKey: "src-1", config: { timeout: 30 } });
      const result = computeComponentDiff([node], [node], [], []);

      expect(result.unchanged).toHaveLength(1);
      expect(result.unchanged[0]!.componentKey).toBe("src-1");
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
    });
  });

  // ── Position-only change → unchanged ───────────────────────────────
  describe("position-only change", () => {
    it("treats position-only difference as unchanged (NOT modified)", () => {
      const oldNode = makeNode({ componentKey: "src-1", positionX: 100, positionY: 200 });
      const newNode = makeNode({ componentKey: "src-1", positionX: 999, positionY: 888 });

      const result = computeComponentDiff([oldNode], [newNode], [], []);

      expect(result.unchanged).toHaveLength(1);
      expect(result.modified).toHaveLength(0);
    });
  });

  // ── displayName-only change → unchanged ────────────────────────────
  describe("displayName-only change", () => {
    it("treats displayName-only difference as unchanged (NOT modified)", () => {
      const oldNode = makeNode({ componentKey: "src-1", displayName: "Old Name" });
      const newNode = makeNode({ componentKey: "src-1", displayName: "New Name" });

      const result = computeComponentDiff([oldNode], [newNode], [], []);

      expect(result.unchanged).toHaveLength(1);
      expect(result.modified).toHaveLength(0);
    });
  });

  // ── Null snapshot inputs ───────────────────────────────────────────
  describe("null snapshot inputs", () => {
    it("handles null oldNodes gracefully", () => {
      const result = computeComponentDiff(null, [makeNode({ componentKey: "a" })], [], []);
      expect(result.added).toHaveLength(1);
      expect(result.removed).toHaveLength(0);
    });

    it("handles null newNodes gracefully", () => {
      const result = computeComponentDiff([makeNode({ componentKey: "a" })], null, [], []);
      expect(result.removed).toHaveLength(1);
      expect(result.added).toHaveLength(0);
    });

    it("handles null oldEdges gracefully", () => {
      const result = computeComponentDiff([], [], null, []);
      expect(result.edgesAdded).toHaveLength(0);
      expect(result.edgesRemoved).toHaveLength(0);
    });

    it("handles null newEdges gracefully", () => {
      const result = computeComponentDiff([], [], [], null);
      expect(result.edgesAdded).toHaveLength(0);
      expect(result.edgesRemoved).toHaveLength(0);
    });

    it("handles all-null inputs without crashing", () => {
      const result = computeComponentDiff(null, null, null, null);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
      expect(result.edgesAdded).toHaveLength(0);
      expect(result.edgesRemoved).toHaveLength(0);
    });
  });

  // ── Empty array inputs ─────────────────────────────────────────────
  describe("empty array inputs", () => {
    it("returns all-empty result for empty arrays", () => {
      const result = computeComponentDiff([], [], [], []);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.unchanged).toHaveLength(0);
      expect(result.edgesAdded).toHaveLength(0);
      expect(result.edgesRemoved).toHaveLength(0);
    });
  });

  // ── Edge diff ──────────────────────────────────────────────────────
  describe("edge diff", () => {
    it("detects added edges", () => {
      const edge = makeEdge({ sourceNodeId: "a", targetNodeId: "b" });
      const result = computeComponentDiff([], [], [], [edge]);

      expect(result.edgesAdded).toHaveLength(1);
      expect(result.edgesAdded[0]!.sourceNodeId).toBe("a");
      expect(result.edgesRemoved).toHaveLength(0);
    });

    it("detects removed edges", () => {
      const edge = makeEdge({ sourceNodeId: "a", targetNodeId: "b" });
      const result = computeComponentDiff([], [], [edge], []);

      expect(result.edgesRemoved).toHaveLength(1);
      expect(result.edgesRemoved[0]!.sourceNodeId).toBe("a");
      expect(result.edgesAdded).toHaveLength(0);
    });

    it("treats identical edges as neither added nor removed", () => {
      const edge = makeEdge({ sourceNodeId: "a", targetNodeId: "b" });
      const result = computeComponentDiff([], [], [edge], [edge]);

      expect(result.edgesAdded).toHaveLength(0);
      expect(result.edgesRemoved).toHaveLength(0);
    });

    it("uses sourceNodeId+targetNodeId as composite key, ignoring edge id", () => {
      const oldEdge = makeEdge({ id: "edge-1", sourceNodeId: "a", targetNodeId: "b" });
      const newEdge = makeEdge({ id: "edge-99", sourceNodeId: "a", targetNodeId: "b" });
      const result = computeComponentDiff([], [], [oldEdge], [newEdge]);

      // Same source→target, different IDs — should NOT appear as added/removed
      expect(result.edgesAdded).toHaveLength(0);
      expect(result.edgesRemoved).toHaveLength(0);
    });
  });

  // ── Multiple changes in one call ───────────────────────────────────
  describe("multiple changes", () => {
    it("correctly classifies a mix of added, removed, modified, and unchanged", () => {
      const oldNodes = [
        makeNode({ componentKey: "kept-same", config: { x: 1 } }),
        makeNode({ componentKey: "will-modify", config: { url: "old" } }),
        makeNode({ componentKey: "will-remove" }),
      ];
      const newNodes = [
        makeNode({ componentKey: "kept-same", config: { x: 1 } }),
        makeNode({ componentKey: "will-modify", config: { url: "new" } }),
        makeNode({ componentKey: "brand-new" }),
      ];

      const oldEdges = [
        makeEdge({ sourceNodeId: "kept-same", targetNodeId: "will-modify" }),
        makeEdge({ sourceNodeId: "will-modify", targetNodeId: "will-remove" }),
      ];
      const newEdges = [
        makeEdge({ sourceNodeId: "kept-same", targetNodeId: "will-modify" }),
        makeEdge({ sourceNodeId: "will-modify", targetNodeId: "brand-new" }),
      ];

      const result = computeComponentDiff(oldNodes, newNodes, oldEdges, newEdges);

      expect(result.unchanged).toHaveLength(1);
      expect(result.unchanged[0]!.componentKey).toBe("kept-same");

      expect(result.modified).toHaveLength(1);
      expect(result.modified[0]!.node.componentKey).toBe("will-modify");

      expect(result.removed).toHaveLength(1);
      expect(result.removed[0]!.componentKey).toBe("will-remove");

      expect(result.added).toHaveLength(1);
      expect(result.added[0]!.componentKey).toBe("brand-new");

      expect(result.edgesAdded).toHaveLength(1);
      expect(result.edgesAdded[0]!.targetNodeId).toBe("brand-new");

      expect(result.edgesRemoved).toHaveLength(1);
      expect(result.edgesRemoved[0]!.targetNodeId).toBe("will-remove");
    });
  });

  // ── Nodes keyed by componentKey, not id ────────────────────────────
  describe("keying by componentKey (not id)", () => {
    it("matches nodes by componentKey even when ids differ", () => {
      const oldNode = makeNode({ componentKey: "src-1", id: "uuid-old" });
      const newNode = makeNode({ componentKey: "src-1", id: "uuid-new" });

      const result = computeComponentDiff([oldNode], [newNode], [], []);

      expect(result.unchanged).toHaveLength(1);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });
  });

  // ── Config deep equality with sorted keys ──────────────────────────
  describe("config deep equality", () => {
    it("treats objects with same keys in different order as equal", () => {
      const oldNode = makeNode({
        componentKey: "src-1",
        config: { b: 2, a: 1 },
      });
      const newNode = makeNode({
        componentKey: "src-1",
        config: { a: 1, b: 2 },
      });

      const result = computeComponentDiff([oldNode], [newNode], [], []);
      expect(result.unchanged).toHaveLength(1);
      expect(result.modified).toHaveLength(0);
    });

    it("detects nested config changes", () => {
      const oldNode = makeNode({
        componentKey: "src-1",
        config: { auth: { type: "basic", user: "admin" } },
      });
      const newNode = makeNode({
        componentKey: "src-1",
        config: { auth: { type: "bearer", token: "xyz" } },
      });

      const result = computeComponentDiff([oldNode], [newNode], [], []);
      expect(result.modified).toHaveLength(1);
      expect(result.modified[0]!.configChanges.length).toBeGreaterThan(0);
    });
  });
});
