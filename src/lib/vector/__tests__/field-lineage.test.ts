import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import type { VectorComponentDef } from "@/lib/vector/types";
import { buildFieldLineage } from "../field-lineage";

function componentDef(
  kind: VectorComponentDef["kind"],
  type: string,
): VectorComponentDef {
  return {
    kind,
    type,
    displayName: type,
    description: type,
    category: "test",
    outputTypes: ["log"],
    inputTypes: kind === "source" ? undefined : ["log"],
    configSchema: {},
  };
}

function node(
  id: string,
  kind: VectorComponentDef["kind"],
  type: string,
  config: Record<string, unknown> = {},
): Node {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      componentDef: componentDef(kind, type),
      componentKey: `${type}_${id}`,
      config,
    },
  };
}

const edge = (source: string, target: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target,
});

describe("buildFieldLineage", () => {
  it("traces source fields through remap additions, removals, renames, and type casts", () => {
    const nodes = [
      node("source", "source", "file"),
      node("remap", "transform", "remap", {
        source: `
          .service = "checkout"
          .status_code = to_int!(.status)
          .message_text = .message
          del(.host)
        `,
      }),
      node("sink", "sink", "elasticsearch"),
    ];

    const result = buildFieldLineage(nodes, [edge("source", "remap"), edge("remap", "sink")], "sink");

    expect(result.fields.find((field) => field.path === ".service")?.status).toBe("added");
    expect(result.fields.find((field) => field.path === ".status_code")?.type).toBe("integer");
    expect(result.fields.find((field) => field.path === ".message_text")?.status).toBe("renamed");
    expect(result.fields.find((field) => field.path === ".host")?.status).toBe("removed");
    expect(result.steps.map((step) => step.nodeId)).toEqual(["source", "remap", "sink"]);
  });

  it("marks fields removed when del targets a field created in the same remap", () => {
    const nodes = [
      node("source", "source", "file"),
      node("remap", "transform", "remap", {
        source: `
          .tmp = "transient"
          del(.tmp)
        `,
      }),
      node("sink", "sink", "elasticsearch"),
    ];

    const result = buildFieldLineage(nodes, [edge("source", "remap"), edge("remap", "sink")], "sink");

    expect(result.fields.find((f) => f.path === ".tmp")?.status).toBe("removed");
  });

  it("persists DLP transform effects into the lineage field map", () => {
    const nodes = [
      node("source", "source", "file"),
      node("dlp", "transform", "dlp_masking"),
      node("sink", "sink", "elasticsearch"),
    ];

    const result = buildFieldLineage(nodes, [edge("source", "dlp"), edge("dlp", "sink")], "sink");

    const messageField = result.fields.find((f) => f.path === ".message");
    expect(messageField?.status).toBe("type_changed");
    expect(messageField?.lastChangedBy).toBe("dlp");
  });

  it("reports missing sink expectations from sink configuration", () => {
    const nodes = [
      node("source", "source", "file"),
      node("sink", "sink", "elasticsearch", {
        id_key: "event_id",
        data_stream: {
          auto_routing: true,
        },
      }),
    ];

    const result = buildFieldLineage(nodes, [edge("source", "sink")], "sink");

    expect(result.expectations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ".event_id", status: "missing" }),
        expect.objectContaining({ path: ".data_stream.type", status: "missing" }),
        expect.objectContaining({ path: ".data_stream.dataset", status: "missing" }),
        expect.objectContaining({ path: ".data_stream.namespace", status: "missing" }),
      ]),
    );
  });
});
