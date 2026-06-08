import { beforeEach, describe, expect, it } from "vitest";
import { useFlowStore } from "@/stores/flow-store";
import type { VectorComponentDef } from "@/lib/vector/types";

// UX-1: replaceNodeComponent swaps a node's component type in place — same id,
// position, and edges — so users can try a different sink/source/transform
// without deleting and rewiring the node.
beforeEach(() => {
  useFlowStore.getState().clearGraph();
});

function def(
  type: string,
  kind: VectorComponentDef["kind"],
  displayName: string,
  properties: Record<string, { default?: unknown }> = {},
): VectorComponentDef {
  return {
    type,
    kind,
    displayName,
    description: "",
    category: "Test",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Box",
    configSchema: { type: "object", properties },
  } as unknown as VectorComponentDef;
}

function addAndGetId(d: VectorComponentDef, x = 0, y = 0): string {
  useFlowStore.getState().addNode(d, { x, y });
  return useFlowStore.getState().nodes.at(-1)!.id;
}

describe("flow-store replaceNodeComponent", () => {
  it("swaps the type within the same kind, preserving id, position, and edges", () => {
    const srcId = addAndGetId(def("demo_logs", "source", "Demo Logs"), 0, 0);
    const sinkId = addAndGetId(def("http", "sink", "HTTP", { uri: { default: "http://x" } }), 200, 0);
    const sinkPos = useFlowStore.getState().nodes.find((n) => n.id === sinkId)!.position;
    useFlowStore.setState({ edges: [{ id: "e1", source: srcId, target: sinkId }] });

    useFlowStore
      .getState()
      .replaceNodeComponent(sinkId, def("kafka", "sink", "Kafka", { topic: { default: "events" } }));

    const state = useFlowStore.getState();
    const replaced = state.nodes.find((n) => n.id === sinkId)!;
    expect(replaced.id).toBe(sinkId); // same id
    expect(replaced.position).toEqual(sinkPos); // position preserved
    expect((replaced.data.componentDef as VectorComponentDef).type).toBe("kafka");
    expect(replaced.data.config).toEqual({ topic: "events" }); // config reset to new defaults
    expect(state.edges).toHaveLength(1); // edge preserved
    expect(state.edges[0].target).toBe(sinkId);
    expect(state.isDirty).toBe(true);
  });

  it("resets an untouched default display name but keeps a user-customized one", () => {
    const a = addAndGetId(def("http", "sink", "HTTP"));
    useFlowStore.getState().replaceNodeComponent(a, def("kafka", "sink", "Kafka"));
    expect(useFlowStore.getState().nodes.find((n) => n.id === a)!.data.displayName).toBe("Kafka");

    const b = addAndGetId(def("http", "sink", "HTTP"));
    useFlowStore.getState().updateDisplayName(b, "Prod egress");
    useFlowStore.getState().replaceNodeComponent(b, def("kafka", "sink", "Kafka"));
    expect(useFlowStore.getState().nodes.find((n) => n.id === b)!.data.displayName).toBe("Prod egress");
  });

  it("is a no-op across kinds (sink → source would orphan edges)", () => {
    const sinkId = addAndGetId(def("http", "sink", "HTTP"));
    const before = useFlowStore.getState().nodes.find((n) => n.id === sinkId)!;
    useFlowStore.getState().replaceNodeComponent(sinkId, def("demo_logs", "source", "Demo Logs"));
    const after = useFlowStore.getState().nodes.find((n) => n.id === sinkId)!;
    expect((after.data.componentDef as VectorComponentDef).type).toBe("http");
    expect(after).toBe(before); // unchanged reference — true no-op
  });

  it("is a no-op when the type is unchanged", () => {
    const sinkId = addAndGetId(def("http", "sink", "HTTP"));
    useFlowStore.setState({ isDirty: false });
    useFlowStore.getState().replaceNodeComponent(sinkId, def("http", "sink", "HTTP"));
    expect(useFlowStore.getState().isDirty).toBe(false); // no snapshot, no dirty
  });

  it("refuses to replace a system-locked node", () => {
    useFlowStore.setState({
      nodes: [
        {
          id: "locked",
          type: "sink",
          position: { x: 0, y: 0 },
          data: {
            componentDef: def("http", "sink", "HTTP"),
            componentKey: "http_1",
            displayName: "HTTP",
            config: {},
            isSystemLocked: true,
          },
        },
      ],
      edges: [],
    });
    useFlowStore.getState().replaceNodeComponent("locked", def("kafka", "sink", "Kafka"));
    expect(
      (useFlowStore.getState().nodes[0].data.componentDef as VectorComponentDef).type,
    ).toBe("http");
  });

  it("refuses to replace a shared-component-linked node", () => {
    useFlowStore.setState({
      nodes: [
        {
          id: "shared",
          type: "sink",
          position: { x: 0, y: 0 },
          data: {
            componentDef: def("http", "sink", "HTTP"),
            componentKey: "http_1",
            displayName: "HTTP",
            config: {},
            sharedComponentId: "sc_1",
          },
        },
      ],
      edges: [],
    });
    useFlowStore.getState().replaceNodeComponent("shared", def("kafka", "sink", "Kafka"));
    expect(
      (useFlowStore.getState().nodes[0].data.componentDef as VectorComponentDef).type,
    ).toBe("http");
  });

  it("clears a stale error badge when the replacement's default config is valid", () => {
    useFlowStore.setState({
      nodes: [
        {
          id: "n",
          type: "sink",
          position: { x: 0, y: 0 },
          data: {
            componentDef: def("http", "sink", "HTTP"),
            componentKey: "http_1",
            displayName: "HTTP",
            config: {},
            hasError: true,
            firstErrorMessage: "old error",
          },
        },
      ],
      edges: [],
    });
    useFlowStore.getState().replaceNodeComponent("n", def("kafka", "sink", "Kafka"));
    const data = useFlowStore.getState().nodes[0].data;
    expect(data.hasError).toBeUndefined();
    expect(data.firstErrorMessage).toBeUndefined();
  });

  it("flags the new node when the replacement's default config is invalid", () => {
    const id = addAndGetId(def("http", "sink", "HTTP"));
    const requiresField = {
      type: "kafka_req",
      kind: "sink",
      displayName: "Kafka (req)",
      description: "",
      category: "Test",
      inputTypes: ["log"],
      outputTypes: ["log"],
      icon: "Box",
      configSchema: {
        type: "object",
        properties: { bootstrap_servers: { type: "string" } },
        required: ["bootstrap_servers"],
      },
    } as unknown as VectorComponentDef;
    useFlowStore.getState().replaceNodeComponent(id, requiresField);
    expect(useFlowStore.getState().nodes.find((n) => n.id === id)!.data.hasError).toBe(true);
  });
});
