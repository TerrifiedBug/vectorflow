import { beforeEach, describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { useFlowStore } from "@/stores/flow-store";

// UX-1: node grouping. A group is a shared `groupId` stamped onto node.data for
// every member of the selection. It is persisted to PipelineNode.groupId so the
// grouping survives a reload; ungrouping clears it. Grouping is undoable.
function node(id: string, groupId?: string): Node {
  return {
    id,
    type: "transform",
    position: { x: 0, y: 0 },
    data: groupId ? { groupId } : {},
  } as Node;
}

function groupIdOf(id: string): string | undefined {
  const n = useFlowStore.getState().nodes.find((x) => x.id === id);
  return (n?.data as { groupId?: string }).groupId;
}

beforeEach(() => {
  useFlowStore.getState().clearGraph();
});

describe("flow-store groupSelectedNodes", () => {
  it("assigns one shared groupId to every selected node, leaving others untouched", () => {
    useFlowStore.setState({
      nodes: [node("a"), node("b"), node("c"), node("d")],
      selectedNodeIds: new Set(["a", "b", "c"]),
    });

    useFlowStore.getState().groupSelectedNodes();

    const gid = groupIdOf("a");
    expect(gid).toBeTruthy();
    // All three selected nodes share the same id…
    expect(groupIdOf("b")).toBe(gid);
    expect(groupIdOf("c")).toBe(gid);
    // …and the unselected node is not pulled into the group.
    expect(groupIdOf("d")).toBeUndefined();
  });

  it("marks the graph dirty when a group is created", () => {
    useFlowStore.setState({
      nodes: [node("a"), node("b")],
      selectedNodeIds: new Set(["a", "b"]),
    });

    useFlowStore.getState().groupSelectedNodes();

    expect(useFlowStore.getState().isDirty).toBe(true);
  });

  it("is a no-op with fewer than two nodes selected", () => {
    useFlowStore.setState({
      nodes: [node("a"), node("b")],
      selectedNodeIds: new Set(["a"]),
    });

    useFlowStore.getState().groupSelectedNodes();

    expect(groupIdOf("a")).toBeUndefined();
    expect(useFlowStore.getState().isDirty).toBe(false);
    expect(useFlowStore.getState().canUndo).toBe(false);
  });

  it("gives distinct groups distinct ids", () => {
    useFlowStore.setState({
      nodes: [node("a"), node("b"), node("c"), node("d")],
      selectedNodeIds: new Set(["a", "b"]),
    });
    useFlowStore.getState().groupSelectedNodes();
    const first = groupIdOf("a");

    useFlowStore.setState({ selectedNodeIds: new Set(["c", "d"]) });
    useFlowStore.getState().groupSelectedNodes();
    const second = groupIdOf("c");

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});

describe("flow-store ungroupNodes", () => {
  it("clears the groupId for every member of the targeted group", () => {
    useFlowStore.setState({
      nodes: [node("a", "g1"), node("b", "g1"), node("c")],
      selectedNodeIds: new Set<string>(),
    });

    useFlowStore.getState().ungroupNodes("g1");

    expect(groupIdOf("a")).toBeUndefined();
    expect(groupIdOf("b")).toBeUndefined();
    expect(useFlowStore.getState().isDirty).toBe(true);
  });

  it("only clears the targeted group, leaving other groups intact", () => {
    useFlowStore.setState({
      nodes: [node("a", "g1"), node("b", "g1"), node("c", "g2"), node("d", "g2")],
      selectedNodeIds: new Set<string>(),
    });

    useFlowStore.getState().ungroupNodes("g1");

    expect(groupIdOf("a")).toBeUndefined();
    expect(groupIdOf("b")).toBeUndefined();
    expect(groupIdOf("c")).toBe("g2");
    expect(groupIdOf("d")).toBe("g2");
  });

  it("is a no-op when no node carries the groupId", () => {
    useFlowStore.setState({
      nodes: [node("a", "g1"), node("b", "g1")],
      selectedNodeIds: new Set<string>(),
    });

    useFlowStore.getState().ungroupNodes("does-not-exist");

    expect(groupIdOf("a")).toBe("g1");
    expect(useFlowStore.getState().isDirty).toBe(false);
    expect(useFlowStore.getState().canUndo).toBe(false);
  });
});

describe("flow-store grouping undo/redo", () => {
  it("undo restores the pre-group state (group removed)", () => {
    useFlowStore.setState({
      nodes: [node("a"), node("b")],
      selectedNodeIds: new Set(["a", "b"]),
    });

    useFlowStore.getState().groupSelectedNodes();
    expect(groupIdOf("a")).toBeTruthy();
    expect(useFlowStore.getState().canUndo).toBe(true);

    useFlowStore.getState().undo();
    expect(groupIdOf("a")).toBeUndefined();
    expect(groupIdOf("b")).toBeUndefined();
  });

  it("undo after ungroup restores the group membership", () => {
    useFlowStore.setState({
      nodes: [node("a", "g1"), node("b", "g1")],
      selectedNodeIds: new Set<string>(),
    });

    useFlowStore.getState().ungroupNodes("g1");
    expect(groupIdOf("a")).toBeUndefined();

    useFlowStore.getState().undo();
    expect(groupIdOf("a")).toBe("g1");
    expect(groupIdOf("b")).toBe("g1");
  });
});
