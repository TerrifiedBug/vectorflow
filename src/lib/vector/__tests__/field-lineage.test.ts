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

  it("respects remap statement order: del then reassign makes field present", () => {
    const nodes = [
      node("source", "source", "file"),
      node("remap", "transform", "remap", {
        source: `
          del(.host)
          .host = "override"
        `,
      }),
      node("sink", "sink", "elasticsearch"),
    ];

    const result = buildFieldLineage(nodes, [edge("source", "remap"), edge("remap", "sink")], "sink");

    expect(result.fields.find((f) => f.path === ".host")?.status).toBe("added");
  });

  it("collects event types from transforms when deriving metric sink expectations", () => {
    const metricTransform: Node = {
      id: "convert",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "transform",
          type: "log_to_metric",
          displayName: "log_to_metric",
          description: "log_to_metric",
          category: "test",
          outputTypes: ["metric"],
          inputTypes: ["log"],
          configSchema: {},
        },
        componentKey: "log_to_metric_convert",
        config: {},
      },
    };
    const mixedSink: Node = {
      id: "sink",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "sink",
          type: "http",
          displayName: "http",
          description: "http",
          category: "test",
          outputTypes: [],
          inputTypes: ["log", "metric"],
          configSchema: {},
        },
        componentKey: "http_sink",
        config: {},
      },
    };
    const nodes = [node("source", "source", "file"), metricTransform, mixedSink];

    const result = buildFieldLineage(
      nodes,
      [edge("source", "convert"), edge("convert", "sink")],
      "sink",
    );

    expect(result.expectations.find((e) => e.path === ".name")).toBeDefined();
    expect(result.expectations.find((e) => e.path === ".kind")).toBeDefined();
  });

  it("applies DLP transform changes to configured fields instead of hard-coded .message", () => {
    const dlpNode: Node = {
      id: "dlp",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "transform",
          type: "dlp_masking",
          displayName: "dlp_masking",
          description: "dlp_masking",
          category: "test",
          outputTypes: ["log"],
          inputTypes: ["log"],
          configSchema: {},
        },
        componentKey: "dlp_masking_dlp",
        config: { fields: ["user.email", "user.name"] },
      },
    };
    const nodes = [node("source", "source", "file"), dlpNode, node("sink", "sink", "elasticsearch")];

    const result = buildFieldLineage(nodes, [edge("source", "dlp"), edge("dlp", "sink")], "sink");

    expect(result.fields.find((f) => f.path === ".user.email")?.lastChangedBy).toBe("dlp");
    expect(result.fields.find((f) => f.path === ".user.name")?.lastChangedBy).toBe("dlp");
    expect(result.fields.find((f) => f.path === ".message")?.status).toBe("source");
  });

  it("does not add metric expectations for log-only pipelines to mixed-input sinks", () => {
    const mixedSink: Node = {
      id: "sink",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "sink",
          type: "http",
          displayName: "http",
          description: "http",
          category: "test",
          outputTypes: [],
          inputTypes: ["log", "metric"],
          configSchema: {},
        },
        componentKey: "http_sink",
        config: {},
      },
    };
    const nodes = [node("source", "source", "file"), mixedSink];

    const result = buildFieldLineage(nodes, [edge("source", "sink")], "sink");

    expect(result.expectations.find((e) => e.path === ".name")).toBeUndefined();
    expect(result.expectations.find((e) => e.path === ".kind")).toBeUndefined();
  });

  it("does not mark field as removed when remove() modifies a nested key", () => {
    const nodes = [
      node("source", "source", "file"),
      node("remap", "transform", "remap", {
        source: `
          .tags = ["env", "prod"]
          remove!(.tags, ["env"])
        `,
      }),
      node("sink", "sink", "elasticsearch"),
    ];

    const result = buildFieldLineage(nodes, [edge("source", "remap"), edge("remap", "sink")], "sink");

    const tagsField = result.fields.find((f) => f.path === ".tags");
    expect(tagsField?.status).toBe("added");
  });

  it("does not remove a field from one branch due to a transform del on a separate branch", () => {
    // Branch A: source-a → remap-a → sink (passes .host through unchanged)
    // Branch B: source-b → remap-b (del(.host)) → sink
    // remap-b deletes .host from its branch; branch A still has .host as "source"
    // merged result at sink must show .host as non-removed (branch A wins)
    const nodes = [
      node("source-a", "source", "file"),
      node("remap-a", "transform", "remap", {
        source: `.service = "api"`,
      }),
      node("source-b", "source", "file"),
      node("remap-b", "transform", "remap", {
        source: `del(.host)`,
      }),
      node("sink", "sink", "elasticsearch"),
    ];

    const result = buildFieldLineage(
      nodes,
      [
        edge("source-a", "remap-a"),
        edge("remap-a", "sink"),
        edge("source-b", "remap-b"),
        edge("remap-b", "sink"),
      ],
      "sink",
    );

    const hostField = result.fields.find((f) => f.path === ".host");
    // .host comes from file source schema in branch A; remap-b's del must not erase it
    expect(hostField?.status).not.toBe("removed");
    expect(hostField?.status).toBe("source");
  });

  it("reports missing sink expectations from sink configuration", () => {
    const nodes = [
      node("source", "source", "file"),
      node("sink", "sink", "elasticsearch", {
        id_key: "event_id",
        // data_stream not configured — no auto_routing expectations
      }),
    ];

    const result = buildFieldLineage(nodes, [edge("source", "sink")], "sink");

    expect(result.expectations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ".event_id", status: "missing" }),
      ]),
    );
  });

  it("skips data_stream field expectations when sync_fields is not explicitly false", () => {
    // sync_fields defaults to true — ES auto-fills these fields; no "missing" warning needed
    const nodes = [
      node("source", "source", "file"),
      node("sink", "sink", "elasticsearch", {
        data_stream: { auto_routing: true },
      }),
    ];

    const result = buildFieldLineage(nodes, [edge("source", "sink")], "sink");

    expect(result.expectations.find((e) => e.path === ".data_stream.type")).toBeUndefined();
    expect(result.expectations.find((e) => e.path === ".data_stream.dataset")).toBeUndefined();
    expect(result.expectations.find((e) => e.path === ".data_stream.namespace")).toBeUndefined();
  });

  it("flags data_stream fields as expectations when sync_fields is explicitly false", () => {
    const nodes = [
      node("source", "source", "file"),
      node("sink", "sink", "elasticsearch", {
        data_stream: { auto_routing: true, sync_fields: false },
      }),
    ];

    const result = buildFieldLineage(nodes, [edge("source", "sink")], "sink");

    expect(result.expectations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ".data_stream.type", status: "missing" }),
        expect.objectContaining({ path: ".data_stream.dataset", status: "missing" }),
        expect.objectContaining({ path: ".data_stream.namespace", status: "missing" }),
      ]),
    );
  });

  it("seeds metric fields for type-changing transforms like log_to_metric", () => {
    const logToMetric: Node = {
      id: "convert",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "transform",
          type: "log_to_metric",
          displayName: "Log to Metric",
          description: "log_to_metric",
          category: "test",
          outputTypes: ["metric"],
          inputTypes: ["log"],
          configSchema: {},
        },
        componentKey: "log_to_metric_convert",
        config: {},
      },
    };
    const metricSink: Node = {
      id: "sink",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "sink",
          type: "prometheus_exporter",
          displayName: "prometheus_exporter",
          description: "prometheus_exporter",
          category: "test",
          outputTypes: [],
          inputTypes: ["metric"],
          configSchema: {},
        },
        componentKey: "prom_sink",
        config: {},
      },
    };
    const nodes = [node("source", "source", "file"), logToMetric, metricSink];

    const result = buildFieldLineage(
      nodes,
      [edge("source", "convert"), edge("convert", "sink")],
      "sink",
    );

    expect(result.fields.find((f) => f.path === ".name")?.status).toBe("added");
    expect(result.fields.find((f) => f.path === ".kind")?.status).toBe("added");
  });

  it("does not add metric expectations when sink inputTypes does not include metric", () => {
    // Multi-type source (log+metric) → log-only sink: sink cannot receive metric events,
    // so .name/.kind/.timestamp must not be flagged as required.
    const multiTypeSource: Node = {
      id: "source",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "source",
          type: "internal_metrics",
          displayName: "internal_metrics",
          description: "",
          category: "test",
          outputTypes: ["log", "metric"],
          configSchema: {},
        },
        componentKey: "source",
        config: {},
      },
    };
    const logOnlySink: Node = {
      id: "sink",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "sink",
          type: "file",
          displayName: "file",
          description: "",
          category: "test",
          outputTypes: [],
          inputTypes: ["log"],
          configSchema: {},
        },
        componentKey: "sink",
        config: {},
      },
    };
    const nodes = [multiTypeSource, logOnlySink];

    const result = buildFieldLineage(nodes, [edge("source", "sink")], "sink");

    expect(result.expectations.find((e) => e.path === ".name")).toBeUndefined();
    expect(result.expectations.find((e) => e.path === ".kind")).toBeUndefined();
  });

  it("merges conflicting-type branch fields to unknown type regardless of edge order", () => {
    // Branch A adds .score as integer; branch B adds .score as string.
    // Result must be the same regardless of which branch is iterated first.
    const nodeA: Node = {
      id: "remap-a",
      position: { x: 0, y: 0 },
      data: {
        componentDef: { kind: "transform", type: "remap", displayName: "remap-a", description: "", category: "test", outputTypes: ["log"], inputTypes: ["log"], configSchema: {} },
        componentKey: "remap-a",
        config: { source: ".score = 42" },
      },
    };
    const nodeB: Node = {
      id: "remap-b",
      position: { x: 0, y: 0 },
      data: {
        componentDef: { kind: "transform", type: "remap", displayName: "remap-b", description: "", category: "test", outputTypes: ["log"], inputTypes: ["log"], configSchema: {} },
        componentKey: "remap-b",
        config: { source: '.score = "high"' },
      },
    };
    const nodes = [node("src-a", "source", "stdin"), nodeA, node("src-b", "source", "stdin"), nodeB, node("sink", "sink", "elasticsearch")];

    // Both orderings of the two sink edges must produce the same result.
    const edgesAB = [edge("src-a", "remap-a"), edge("remap-a", "sink"), edge("src-b", "remap-b"), edge("remap-b", "sink")];
    const edgesBA = [edge("src-b", "remap-b"), edge("remap-b", "sink"), edge("src-a", "remap-a"), edge("remap-a", "sink")];

    const resultAB = buildFieldLineage(nodes, edgesAB, "sink");
    const resultBA = buildFieldLineage(nodes, edgesBA, "sink");

    const scoreAB = resultAB.fields.find((f) => f.path === ".score");
    const scoreBA = resultBA.fields.find((f) => f.path === ".score");
    expect(scoreAB?.type).toBe("unknown");
    expect(scoreAB?.status).toBe("type_changed");
    expect(scoreBA?.type).toBe(scoreAB?.type);
    expect(scoreBA?.status).toBe(scoreAB?.status);
  });

  it("does not emit metric expectations after a metric-to-log type-converting transform", () => {
    const metricSource: Node = {
      id: "source",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "source",
          type: "host_metrics",
          displayName: "host_metrics",
          description: "",
          category: "test",
          outputTypes: ["metric"],
          configSchema: {},
        },
        componentKey: "source",
        config: {},
      },
    };
    const metricToLog: Node = {
      id: "convert",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "transform",
          type: "metric_to_log",
          displayName: "metric_to_log",
          description: "",
          category: "test",
          outputTypes: ["log"],
          inputTypes: ["metric"],
          configSchema: {},
        },
        componentKey: "convert",
        config: {},
      },
    };
    const logSink: Node = {
      id: "sink",
      position: { x: 0, y: 0 },
      data: {
        componentDef: {
          kind: "sink",
          type: "file",
          displayName: "file",
          description: "",
          category: "test",
          outputTypes: [],
          inputTypes: ["log"],
          configSchema: {},
        },
        componentKey: "sink",
        config: {},
      },
    };
    const nodes = [metricSource, metricToLog, logSink];

    const result = buildFieldLineage(
      nodes,
      [edge("source", "convert"), edge("convert", "sink")],
      "sink",
    );

    expect(result.expectations.find((e) => e.path === ".name")).toBeUndefined();
    expect(result.expectations.find((e) => e.path === ".kind")).toBeUndefined();
  });
});
