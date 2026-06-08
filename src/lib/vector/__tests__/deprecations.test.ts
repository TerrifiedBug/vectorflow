import { describe, it, expect } from "vitest";
import { findComponentDef } from "@/lib/vector/catalog";
import {
  COMPONENT_DEPRECATIONS,
  findComponentDeprecation,
  findDeprecatedComponents,
} from "@/lib/vector/deprecations";

describe("findComponentDeprecation", () => {
  it("flags a renamed component and names its modern replacement", () => {
    const dep = findComponentDeprecation("generator", "source");
    expect(dep?.replacement).toBe("demo_logs");
    expect(dep?.reason).toMatch(/renamed to demo_logs/);
  });

  it("does not flag the modern replacement component", () => {
    expect(findComponentDeprecation("demo_logs", "source")).toBeUndefined();
  });

  it("disambiguates by kind: prometheus source vs sink map to different replacements", () => {
    expect(findComponentDeprecation("prometheus", "source")?.replacement).toBe(
      "prometheus_scrape",
    );
    expect(findComponentDeprecation("prometheus", "sink")?.replacement).toBe(
      "prometheus_exporter",
    );
  });

  it("only flags the deprecated kind: splunk_hec sink renamed, source still current", () => {
    expect(findComponentDeprecation("splunk_hec", "sink")?.replacement).toBe(
      "splunk_hec_logs",
    );
    // The splunk_hec *source* is a current Vector component — must NOT be flagged.
    expect(findComponentDeprecation("splunk_hec", "source")).toBeUndefined();
  });

  it("flags transforms removed in favor of remap", () => {
    expect(findComponentDeprecation("grok_parser", "transform")?.replacement).toBe(
      "remap",
    );
    expect(findComponentDeprecation("json_parser", "transform")?.replacement).toBe(
      "remap",
    );
  });

  it("returns undefined for an unknown component type", () => {
    expect(findComponentDeprecation("definitely_not_a_component", "source")).toBeUndefined();
  });
});

describe("findDeprecatedComponents", () => {
  it("returns one finding per deprecated node and ignores current components", () => {
    const findings = findDeprecatedComponents([
      { id: "n1", componentType: "new_relic_logs", kind: "SINK", displayName: "NR" },
      { id: "n2", componentType: "http", kind: "SINK", displayName: "Webhook" },
      { id: "n3", componentType: "grok_parser", kind: "TRANSFORM", displayName: "Parse" },
    ]);

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.nodeId)).toEqual(["n1", "n3"]);
    expect(findings[0]).toMatchObject({
      nodeId: "n1",
      type: "new_relic_logs",
      replacement: "new_relic",
      kind: "sink",
    });
    expect(findings[1]?.replacement).toBe("remap");
  });

  it("normalizes the Prisma ComponentKind enum (uppercase) when matching", () => {
    // splunk_hec is only deprecated as a sink; a SOURCE node must not be flagged.
    const findings = findDeprecatedComponents([
      { id: "src", componentType: "splunk_hec", kind: "SOURCE", displayName: "HEC in" },
      { id: "snk", componentType: "splunk_hec", kind: "SINK", displayName: "HEC out" },
    ]);
    expect(findings.map((f) => f.nodeId)).toEqual(["snk"]);
    expect(findings[0]?.kind).toBe("sink");
  });

  it("falls back to the component type when a node has no display name", () => {
    const [finding] = findDeprecatedComponents([
      { id: "n1", componentType: "generator", kind: "SOURCE", displayName: "  " },
    ]);
    expect(finding?.nodeName).toBe("generator");
  });

  it("returns an empty array when no nodes are deprecated", () => {
    expect(
      findDeprecatedComponents([
        { id: "n1", componentType: "demo_logs", kind: "SOURCE" },
        { id: "n2", componentType: "remap", kind: "TRANSFORM" },
      ]),
    ).toEqual([]);
  });

  it("skips malformed/partial nodes instead of throwing (advisory, must not break get)", () => {
    const findings = findDeprecatedComponents([
      { id: "bad1", componentType: "generator" } as never, // missing kind
      { id: "bad2", kind: "SOURCE" } as never, // missing componentType
      { id: "ok", componentType: "generator", kind: "SOURCE" },
    ]);
    expect(findings.map((f) => f.nodeId)).toEqual(["ok"]);
  });
});

describe("COMPONENT_DEPRECATIONS dataset integrity", () => {
  it("every replacement points at a component that exists in the current catalog", () => {
    for (const dep of COMPONENT_DEPRECATIONS) {
      const replacement = findComponentDef(dep.replacement, dep.kind);
      expect(
        replacement,
        `replacement "${dep.replacement}" (${dep.kind ?? "any"}) for deprecated "${dep.type}" must exist in the catalog`,
      ).toBeDefined();
    }
  });
});
