import { beforeEach, describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { useFlowStore } from "@/stores/flow-store";
import type { VectorComponentDef } from "@/lib/vector/types";
import type { AiSuggestion } from "@/lib/ai/types";

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
      },
    });
    expect(edge.data).not.toHaveProperty("running");
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
      },
    });
    expect(edge.data).not.toHaveProperty("running");
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

  it("loadGraph preserves existing running true runtime data", () => {
    useFlowStore.getState().loadGraph(nodes, [
      {
        id: "edge-1",
        source: "source-1",
        target: "transform-1",
        data: {
          running: true,
        },
      },
    ] as Edge[]);

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

  it("pasteFromSession inserts metric edges with source and target kinds", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: () =>
          JSON.stringify({
            nodes: [
              {
                componentKey: "source-original",
                componentType: "source-test",
                kind: "source",
                config: {},
                disabled: false,
                relativePosition: { x: 0, y: 0 },
              },
              {
                componentKey: "transform-original",
                componentType: "transform-test",
                kind: "transform",
                config: {},
                disabled: false,
                relativePosition: { x: 100, y: 0 },
              },
            ],
            edges: [
              {
                sourceKey: "source-original",
                targetKey: "transform-original",
                sourcePort: null,
              },
            ],
          }),
      },
    });

    useFlowStore.getState().pasteFromSession();

    const edge = useFlowStore.getState().edges[0];
    expect(edge).toMatchObject({
      type: "metric",
      data: {
        sourceKind: "source",
        targetKind: "transform",
      },
    });
    expect(edge.data).not.toHaveProperty("running");
  });

  it("applySuggestions inserts metric edges with source and target kinds", () => {
    useFlowStore.getState().loadGraph(nodes, []);

    const suggestion: AiSuggestion = {
      id: "suggestion-1",
      title: "Connect source to transform",
      description: "Add edge",
      priority: "medium",
      type: "modify_connections",
      edgeChanges: [{ action: "add", from: "source-1", to: "transform-1" }],
    };

    const { results } = useFlowStore.getState().applySuggestions([suggestion]);

    expect(results).toEqual([{ suggestionId: "suggestion-1", success: true }]);
    const edge = useFlowStore.getState().edges[0];
    expect(edge).toMatchObject({
      type: "metric",
      data: {
        sourceKind: "source",
        targetKind: "transform",
      },
    });
    expect(edge.data).not.toHaveProperty("running");
  });
});
