import { beforeEach, describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { useFlowStore } from "@/stores/flow-store";

// UX-5 (editor ergonomics): align/distribute operate on the multi-selection,
// using measured node dimensions for right/bottom/center so edges line up.
function node(id: string, x: number, y: number, w = 100, h = 40): Node {
  return {
    id,
    type: "vector",
    position: { x, y },
    data: {},
    measured: { width: w, height: h },
  } as Node;
}

function xs(): number[] {
  return useFlowStore.getState().nodes.map((n) => n.position.x);
}
function ys(): number[] {
  return useFlowStore.getState().nodes.map((n) => n.position.y);
}

beforeEach(() => {
  useFlowStore.getState().clearGraph();
});

describe("flow-store align/distribute", () => {
  it("aligns selected nodes to the leftmost edge", () => {
    useFlowStore.setState({
      nodes: [node("a", 10, 0), node("b", 50, 100), node("c", 200, 200)],
      selectedNodeIds: new Set(["a", "b", "c"]),
    });
    useFlowStore.getState().alignSelectedNodes("left");
    expect(xs()).toEqual([10, 10, 10]);
  });

  it("center-x centers each node on the group's horizontal midpoint", () => {
    // a: left 0..right 100; b: left 300..right 400 → span center = 200; w=100 → x=150
    useFlowStore.setState({
      nodes: [node("a", 0, 0, 100, 40), node("b", 300, 0, 100, 40)],
      selectedNodeIds: new Set(["a", "b"]),
    });
    useFlowStore.getState().alignSelectedNodes("center-x");
    expect(xs()).toEqual([150, 150]);
  });

  it("right aligns nodes' right edges using measured width", () => {
    // a right=10+100=110; b right=300+50=350 → maxRight 350; a(w100)→250, b(w50)→300
    useFlowStore.setState({
      nodes: [node("a", 10, 0, 100, 40), node("b", 300, 0, 50, 40)],
      selectedNodeIds: new Set(["a", "b"]),
    });
    useFlowStore.getState().alignSelectedNodes("right");
    expect(xs()).toEqual([250, 300]);
  });

  it("distributes 3+ nodes evenly on the horizontal axis", () => {
    useFlowStore.setState({
      nodes: [node("a", 0, 0), node("b", 30, 0), node("c", 300, 0)],
      selectedNodeIds: new Set(["a", "b", "c"]),
    });
    useFlowStore.getState().distributeSelectedNodes("horizontal");
    expect([...xs()].sort((p, q) => p - q)).toEqual([0, 150, 300]);
  });

  it("distributes evenly on the vertical axis", () => {
    useFlowStore.setState({
      nodes: [node("a", 0, 0), node("b", 0, 10), node("c", 0, 90), node("d", 0, 300)],
      selectedNodeIds: new Set(["a", "b", "c", "d"]),
    });
    useFlowStore.getState().distributeSelectedNodes("vertical");
    expect([...ys()].sort((p, q) => p - q)).toEqual([0, 100, 200, 300]);
  });

  it("no-ops align with <2 and distribute with <3 selected", () => {
    useFlowStore.setState({
      nodes: [node("a", 5, 5), node("b", 60, 60)],
      selectedNodeIds: new Set(["a"]),
    });
    useFlowStore.getState().alignSelectedNodes("left");
    expect(xs()).toEqual([5, 60]);

    useFlowStore.setState({ selectedNodeIds: new Set(["a", "b"]) });
    useFlowStore.getState().distributeSelectedNodes("horizontal");
    expect(xs()).toEqual([5, 60]);
  });

  it("records an undo step that restores original positions", () => {
    useFlowStore.setState({
      nodes: [node("a", 10, 0), node("b", 50, 0)],
      selectedNodeIds: new Set(["a", "b"]),
    });
    useFlowStore.getState().alignSelectedNodes("left");
    expect(xs()).toEqual([10, 10]);
    expect(useFlowStore.getState().canUndo).toBe(true);
    useFlowStore.getState().undo();
    expect(xs()).toEqual([10, 50]);
  });

  it("never moves a system-locked node, even when selected", () => {
    const locked = { ...node("locked", 500, 500), data: { isSystemLocked: true } } as Node;
    useFlowStore.setState({
      nodes: [node("a", 10, 0), node("b", 80, 0), locked],
      selectedNodeIds: new Set(["a", "b", "locked"]),
    });
    useFlowStore.getState().alignSelectedNodes("left");
    // a & b align to their own leftmost (10); the locked node stays at 500.
    expect(xs()).toEqual([10, 10, 500]);
  });
});
