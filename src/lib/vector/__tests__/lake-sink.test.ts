import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import type { Node, Edge } from "@xyflow/react";
import {
  LAKE_SINK_TYPE,
  LAKE_EVENTS_TABLE,
  renderLakeSinkBlock,
  resolveLakeSinkForDelivery,
  configHasLakeSink,
  type LakeSinkCreds,
} from "../lake-sink";
import { getVectorCatalog } from "@/lib/vector/catalog";
import { generateVectorYaml } from "@/lib/config-generator/yaml-generator";

function flowNode(
  id: string,
  type: string,
  kind: string,
  componentKey: string,
  config: Record<string, unknown> = {},
): Node {
  return {
    id,
    type: "default",
    position: { x: 0, y: 0 },
    data: { componentDef: { type, kind }, componentKey, config },
  } as unknown as Node;
}

const CREDS: LakeSinkCreds = {
  endpoint: "http://clickhouse:8123",
  database: "vectorflow_lake",
  username: "vf",
  password: "s3cr3t",
};

/** A delivery config carrying one managed lake sink wired to `in`. */
function lakeDeliveryConfig(): Record<string, unknown> {
  return { sinks: { lake: { ...renderLakeSinkBlock(), inputs: ["in"] } } };
}

describe("VectorFlow Lake sink — catalog entry", () => {
  it("is registered as a managed sink accepting logs, metrics and traces", () => {
    const def = getVectorCatalog().find(
      (d) => d.type === LAKE_SINK_TYPE && d.kind === "sink",
    );
    expect(def).toBeDefined();
    expect(def?.inputTypes).toEqual(
      expect.arrayContaining(["log", "metric", "trace"]),
    );
  });

  it("exposes no connection fields (endpoint/database/credentials are delivery-injected)", () => {
    const def = getVectorCatalog().find((d) => d.type === LAKE_SINK_TYPE);
    const properties = (def?.configSchema as { properties?: Record<string, unknown> })
      .properties;
    expect(properties).toEqual({});
    expect(properties).not.toHaveProperty("endpoint");
    expect(properties).not.toHaveProperty("auth");
  });
});

describe("renderLakeSinkBlock", () => {
  it("renders a clickhouse sink targeting lake_events with placeholder credentials only", () => {
    const block = renderLakeSinkBlock();
    expect(block.type).toBe("clickhouse");
    expect(block.table).toBe(LAKE_EVENTS_TABLE);
    expect(block.endpoint).toBe("LAKE[endpoint]");
    expect(block.database).toBe("LAKE[database]");
    expect(block.auth).toMatchObject({
      strategy: "basic",
      user: "LAKE[user]",
      password: "LAKE[password]",
    });
    // No concrete connection values leak into the rendered block.
    expect(JSON.stringify(block)).not.toContain("clickhouse:8123");
  });
});

describe("generateVectorYaml — lake sink rendering", () => {
  it("renders the lake preset to a clickhouse sink block with wired inputs, never the catalog type", () => {
    const nodes = [
      flowNode("s1", "stdin", "source", "in"),
      flowNode("l1", LAKE_SINK_TYPE, "sink", "lake"),
    ];
    const edges = [{ id: "e1", source: "s1", target: "l1" }] as Edge[];

    const out = generateVectorYaml(nodes, edges);
    const parsed = yaml.load(out) as {
      sinks: Record<string, Record<string, unknown>>;
    };

    expect(parsed.sinks.lake.type).toBe("clickhouse");
    expect(parsed.sinks.lake.table).toBe(LAKE_EVENTS_TABLE);
    expect(parsed.sinks.lake.endpoint).toBe("LAKE[endpoint]");
    expect(parsed.sinks.lake.inputs).toEqual(["in"]);
    // The Vector-unknown catalog type must never reach the rendered config.
    expect(out).not.toContain(LAKE_SINK_TYPE);
  });
});

describe("resolveLakeSinkForDelivery — lake enabled", () => {
  it("replaces placeholders with concrete endpoint/database/credentials", () => {
    const { config, applied } = resolveLakeSinkForDelivery(lakeDeliveryConfig(), CREDS);
    expect(applied).toBe(true);
    const sink = (config.sinks as Record<string, Record<string, unknown>>).lake;
    expect(sink.endpoint).toBe(CREDS.endpoint);
    expect(sink.database).toBe(CREDS.database);
    expect(sink.table).toBe(LAKE_EVENTS_TABLE);
    expect(sink.auth).toEqual({ strategy: "basic", user: "vf", password: "s3cr3t" });
    expect(sink.inputs).toEqual(["in"]);
    // Every placeholder token is resolved.
    expect(JSON.stringify(config)).not.toContain("LAKE[");
  });

  it("injects a normalization remap mapping events onto the lake_events schema", () => {
    const { config } = resolveLakeSinkForDelivery(lakeDeliveryConfig(), CREDS, {
      orgId: "org_abc",
      pipelineId: "pl_xyz",
    });
    const transforms = config.transforms as Record<string, Record<string, unknown>>;
    const normalize = transforms.lake__lake_normalize;
    expect(normalize.type).toBe("remap");
    // Takes the sink's original inputs…
    expect(normalize.inputs).toEqual(["in"]);
    // …and the sink now reads from the normalize transform.
    const sink = (config.sinks as Record<string, Record<string, unknown>>).lake;
    expect(sink.inputs).toEqual(["lake__lake_normalize"]);
    // The VRL stamps org/pipeline + the columns search/replay filter on.
    const src = normalize.source as string;
    expect(src).toContain('.organizationId = "org_abc"');
    expect(src).toContain('.pipelineId = "pl_xyz"');
    expect(src).toContain(".eventType");
    expect(src).toContain(".raw = encode_json(.)");
  });

  it("drops the auth block when the lake server is unauthenticated", () => {
    const { config } = resolveLakeSinkForDelivery(lakeDeliveryConfig(), {
      endpoint: "http://ch:8123",
      database: "vectorflow_lake",
    });
    const sink = (config.sinks as Record<string, Record<string, unknown>>).lake;
    expect(sink.endpoint).toBe("http://ch:8123");
    expect(sink).not.toHaveProperty("auth");
  });
});

describe("resolveLakeSinkForDelivery — lake disabled", () => {
  it("rewrites the lake sink to a no-op blackhole, preserving inputs", () => {
    const { config, applied } = resolveLakeSinkForDelivery(lakeDeliveryConfig(), null);
    expect(applied).toBe(true);
    const sink = (config.sinks as Record<string, Record<string, unknown>>).lake;
    expect(sink.type).toBe("blackhole");
    expect(sink.inputs).toEqual(["in"]);
    expect(sink).not.toHaveProperty("endpoint");
    expect(sink).not.toHaveProperty("auth");
  });
});

describe("resolveLakeSinkForDelivery — no lake sink", () => {
  it("leaves a config without a lake sink untouched", () => {
    const config = {
      sinks: {
        ch: { type: "clickhouse", endpoint: "http://real:8123", table: "logs", inputs: ["in"] },
      },
    };
    const result = resolveLakeSinkForDelivery(config, CREDS);
    expect(result.applied).toBe(false);
    expect(result.config).toBe(config);
  });
});

describe("configHasLakeSink", () => {
  it("detects the managed lake sink", () => {
    expect(configHasLakeSink(lakeDeliveryConfig())).toBe(true);
  });

  it("returns false for a plain clickhouse sink with literal connection details", () => {
    expect(
      configHasLakeSink({
        sinks: { ch: { type: "clickhouse", endpoint: "http://real:8123", table: "logs" } },
      }),
    ).toBe(false);
  });

  it("returns false when there are no sinks", () => {
    expect(configHasLakeSink({ sources: { in: { type: "stdin" } } })).toBe(false);
  });
});
