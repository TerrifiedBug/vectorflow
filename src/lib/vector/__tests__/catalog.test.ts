import { describe, it, expect } from "vitest";
import { getVectorCatalog, findComponentDef } from "@/lib/vector/catalog";

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
});
