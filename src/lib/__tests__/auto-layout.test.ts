import { describe, it, expect } from "vitest";
import { applyAutoLayout } from "@/lib/auto-layout";
import type { Node, Edge } from "@xyflow/react";

describe("applyAutoLayout", () => {
  it("returns positioned nodes for a simple chain", () => {
    const nodes: Node[] = [
      { id: "a", position: { x: 0, y: 0 }, data: {} },
      { id: "b", position: { x: 0, y: 0 }, data: {} },
      { id: "c", position: { x: 0, y: 0 }, data: {} },
    ];
    const edges: Edge[] = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
    ];

    const result = applyAutoLayout(nodes, edges);

    expect(result).toHaveLength(3);
    // Nodes should have different y positions (top-to-bottom layout)
    const yPositions = result.map((n) => n.position.y);
    expect(yPositions[0]).toBeLessThan(yPositions[1]);
    expect(yPositions[1]).toBeLessThan(yPositions[2]);
  });

  it("handles empty nodes array", () => {
    const result = applyAutoLayout([], []);
    expect(result).toEqual([]);
  });

  it("handles disconnected nodes", () => {
    const nodes: Node[] = [
      { id: "a", position: { x: 0, y: 0 }, data: {} },
      { id: "b", position: { x: 100, y: 100 }, data: {} },
    ];

    const result = applyAutoLayout(nodes, []);
    expect(result).toHaveLength(2);
    // Both nodes should get positions from dagre
    expect(typeof result[0].position.x).toBe("number");
    expect(typeof result[1].position.x).toBe("number");
  });

  it("only repositions selected nodes when nodeIds is provided", () => {
    const nodes: Node[] = [
      { id: "a", position: { x: 10, y: 20 }, data: {} },
      { id: "b", position: { x: 30, y: 40 }, data: {} },
      { id: "c", position: { x: 50, y: 60 }, data: {} },
    ];
    const edges: Edge[] = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
    ];

    const result = applyAutoLayout(nodes, edges, { nodeIds: new Set(["a", "b"]) });

    // "c" should keep its original position
    const nodeC = result.find((n) => n.id === "c");
    expect(nodeC?.position).toEqual({ x: 50, y: 60 });

    // "a" and "b" should have new positions
    const nodeA = result.find((n) => n.id === "a");
    expect(nodeA?.position).not.toEqual({ x: 10, y: 20 });
  });
});
