import { beforeEach, describe, expect, it } from "vitest";
import { useFlowStore } from "@/stores/flow-store";
import type { VectorComponentDef } from "@/lib/vector/types";

// NF-5: addNode seeds a node's initial config from schema defaults. Top-level
// string defaults were already applied; nested object defaults (e.g. the
// OpenTelemetry sink's `protocol` block) must be seeded too, otherwise
// deploy-time-required nested fields (protocol.type, encoding.codec) are never
// emitted into the generated Vector config.
beforeEach(() => {
  useFlowStore.getState().clearGraph();
});

function lastConfig(): Record<string, unknown> {
  const node = useFlowStore.getState().nodes.at(-1);
  return (node?.data?.config ?? {}) as Record<string, unknown>;
}

describe("flow-store addNode default config", () => {
  it("seeds top-level string defaults and nested object defaults", () => {
    const def = {
      type: "opentelemetry",
      kind: "sink",
      displayName: "OpenTelemetry",
      description: "",
      category: "Network",
      inputTypes: ["log"],
      outputTypes: ["log"],
      icon: "Webhook",
      configSchema: {
        type: "object",
        properties: {
          method: { type: "string", default: "post" },
          protocol: {
            type: "object",
            default: { type: "http", encoding: { codec: "otlp" } },
            properties: { uri: { type: "string" } },
          },
        },
      },
    } as unknown as VectorComponentDef;

    useFlowStore.getState().addNode(def, { x: 0, y: 0 });

    const config = lastConfig();
    expect(config.method).toBe("post");
    expect(config.protocol).toEqual({
      type: "http",
      encoding: { codec: "otlp" },
    });
  });

  it("deep-clones object defaults so the shared schema is never mutated", () => {
    const sharedDefault = { type: "http", encoding: { codec: "otlp" } };
    const def = {
      type: "otel-clone-test",
      kind: "sink",
      displayName: "x",
      description: "",
      category: "Network",
      inputTypes: ["log"],
      outputTypes: ["log"],
      icon: "Send",
      configSchema: {
        type: "object",
        properties: {
          protocol: { type: "object", default: sharedDefault, properties: {} },
        },
      },
    } as unknown as VectorComponentDef;

    useFlowStore.getState().addNode(def, { x: 0, y: 0 });
    const protocol = lastConfig().protocol as { type: string };
    protocol.type = "MUTATED";

    // The schema's default object must be untouched by the per-node clone.
    expect(sharedDefault.type).toBe("http");
  });
});
