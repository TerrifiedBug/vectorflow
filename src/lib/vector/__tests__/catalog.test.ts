import { describe, it, expect } from "vitest";
import { getVectorCatalog, findComponentDef } from "@/lib/vector/catalog";
import { validateNodeConfig } from "@/lib/vector/validate-node-config";

describe("Vector Catalog (PERF-04)", () => {
  it("getVectorCatalog returns a non-empty array", () => {
    const catalog = getVectorCatalog();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThan(0);
  });

  it("getVectorCatalog returns same reference on repeated calls (singleton)", () => {
    const first = getVectorCatalog();
    const second = getVectorCatalog();
    expect(first).toBe(second); // same reference, not just equal
  });

  it("findComponentDef finds a known component", () => {
    const httpSource = findComponentDef("http_server", "source");
    expect(httpSource).toBeDefined();
    expect(httpSource?.type).toBe("http_server");
  });

  it("findComponentDef returns undefined for unknown type", () => {
    const result = findComponentDef("nonexistent_component_xyz");
    expect(result).toBeUndefined();
  });

  it("ships both OpenTelemetry source and sink (NF-5: OTEL → Vector → OTEL)", () => {
    expect(findComponentDef("opentelemetry", "source")?.kind).toBe("source");
    const sink = findComponentDef("opentelemetry", "sink");
    expect(sink?.kind).toBe("sink");
    // Pairs with the source across all three signal types.
    expect(sink?.inputTypes).toEqual(
      expect.arrayContaining(["log", "metric", "trace"]),
    );
    // OTLP/HTTP shape: uri + encoding live under `protocol`.
    const protocol = sink?.configSchema?.properties?.protocol as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(protocol?.properties).toHaveProperty("uri");
    expect(protocol?.properties).toHaveProperty("encoding");
  });

  it("OpenTelemetry sink validation enforces nested protocol fields (NF-5)", () => {
    const schema = findComponentDef("opentelemetry", "sink")!
      .configSchema as object;
    // Imported/edited config: protocol present but type + encoding missing → invalid.
    expect(
      validateNodeConfig(
        { protocol: { uri: "https://c:4318/v1/logs" } },
        schema,
      ).hasError,
    ).toBe(true);
    // Fully specified → valid.
    expect(
      validateNodeConfig(
        {
          protocol: {
            type: "http",
            uri: "https://c:4318/v1/logs",
            encoding: { codec: "otlp" },
          },
        },
        schema,
      ).hasError,
    ).toBe(false);
  });
});
