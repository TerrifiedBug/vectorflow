import { beforeEach, describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { useFlowStore } from "@/stores/flow-store";
import type { VectorComponentDef } from "@/lib/vector/types";

function makeNode(id: string, kind: VectorComponentDef["kind"]): Node {
  const componentDef: VectorComponentDef = {
    type: `${kind}-test`,
    kind,
    displayName: `${kind} test`,
    description: "Test component",
    category: "test",
    outputTypes: ["metric"],
    configSchema: {},
  };

  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: {
      componentDef,
      componentKey: id,
      config: {},
    },
  };
}

const nodes = [makeNode("source-1", "source"), makeNode("transform-1", "transform")];

beforeEach(() => {
  useFlowStore.getState().clearGraph();
});

describe("flow-store metric edge runtime metadata", () => {
  it("onConnect creates metric edges with source and target kinds", () => {
    useFlowStore.getState().loadGraph(nodes, []);

    useFlowStore.getState().onConnect({
      source: "source-1",
      target: "transform-1",
      sourceHandle: null,
      targetHandle: null,
    });

    const edge = useFlowStore.getState().edges[0];
    expect(edge).toMatchObject({
      type: "metric",
      data: {
        sourceKind: "source",
        targetKind: "transform",
        running: true,
      },
    });
  });

  it("loadGraph normalizes persisted edges as metric edges with source and target kinds", () => {
    useFlowStore.getState().loadGraph(nodes, [
      {
        id: "edge-1",
        source: "source-1",
        target: "transform-1",
      },
    ] as Edge[]);

    const edge = useFlowStore.getState().edges[0];
    expect(edge).toMatchObject({
      id: "edge-1",
      type: "metric",
      data: {
        sourceKind: "source",
        targetKind: "transform",
        running: true,
      },
    });
  });

  it("loadGraph preserves existing edge data when filling missing metric metadata", () => {
    useFlowStore.getState().loadGraph(nodes, [
      {
        id: "edge-1",
        source: "source-1",
        target: "transform-1",
        type: "default",
        data: {
          label: "existing",
          sourceKind: "legacy-source",
          running: false,
        },
      },
    ] as Edge[]);

    const edge = useFlowStore.getState().edges[0];
    expect(edge).toMatchObject({
      type: "metric",
      data: {
        label: "existing",
        sourceKind: "legacy-source",
        targetKind: "transform",
        running: false,
      },
    });
  });
});
