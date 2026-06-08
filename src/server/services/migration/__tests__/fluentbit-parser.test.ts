import { describe, it, expect } from "vitest";
import { parseFluentbitConfig } from "../fluentbit-parser";
import { computeReadiness } from "../readiness";

// A representative Kubernetes-style Fluent Bit "classic" config:
// one [SERVICE], two [INPUT], one [FILTER], one [OUTPUT], plus an @INCLUDE.
const REPRESENTATIVE_CONFIG = `
[SERVICE]
    Flush        5
    Daemon       Off
    Log_Level    info
    Parsers_File parsers.conf

@INCLUDE inputs.conf

[INPUT]
    Name             tail
    Path             /var/log/containers/*.log
    Tag              kube.*
    Parser           docker
    Mem_Buf_Limit    5MB

# pull systemd journal too
[INPUT]
    Name            systemd
    Tag             host.*
    Systemd_Filter  _SYSTEMD_UNIT=kubelet.service

[FILTER]
    Name      kubernetes
    Match     kube.*
    Merge_Log On
    Keep_Log  Off

[OUTPUT]
    Name   es
    Match  *
    Host   elasticsearch.logging.svc
    Port   9200
    Index  fluentbit
`;

describe("parseFluentbitConfig", () => {
  describe("representative config", () => {
    const result = parseFluentbitConfig(REPRESENTATIVE_CONFIG);

    it("emits one block per pipeline section ([SERVICE] excluded)", () => {
      expect(result.blocks).toHaveLength(4);
    });

    it("maps [INPUT] -> source with pluginType from Name", () => {
      const tail = result.blocks[0];
      expect(tail.blockType).toBe("source");
      expect(tail.pluginType).toBe("tail");
      expect(tail.tagPattern).toBeNull();
      // Non-Name keys become params; the source's Tag stays in params.
      expect(tail.params.Path).toBe("/var/log/containers/*.log");
      expect(tail.params.Tag).toBe("kube.*");
      expect(tail.params.Parser).toBe("docker");
      expect(tail.params.Mem_Buf_Limit).toBe("5MB");
      // Name is lifted to pluginType, not left in params.
      expect(tail.params.Name).toBeUndefined();

      const systemd = result.blocks[1];
      expect(systemd.blockType).toBe("source");
      expect(systemd.pluginType).toBe("systemd");
      expect(systemd.params.Systemd_Filter).toBe("_SYSTEMD_UNIT=kubelet.service");
    });

    it("maps [FILTER] -> filter with Match lifted to tagPattern", () => {
      const filter = result.blocks[2];
      expect(filter.blockType).toBe("filter");
      expect(filter.pluginType).toBe("kubernetes");
      expect(filter.tagPattern).toBe("kube.*");
      expect(filter.params.Merge_Log).toBe("On");
      expect(filter.params.Keep_Log).toBe("Off");
      // Match is the routing pattern, not a config param.
      expect(filter.params.Match).toBeUndefined();
      expect(filter.params.Name).toBeUndefined();
    });

    it("maps [OUTPUT] -> match (sink) with Match lifted to tagPattern", () => {
      const output = result.blocks[3];
      expect(output.blockType).toBe("match");
      expect(output.pluginType).toBe("es");
      expect(output.tagPattern).toBe("*");
      expect(output.params.Host).toBe("elasticsearch.logging.svc");
      expect(output.params.Port).toBe("9200");
      expect(output.params.Index).toBe("fluentbit");
      expect(output.params.Match).toBeUndefined();
    });

    it("collects [SERVICE] keys as globalParams", () => {
      expect(result.globalParams.Flush).toBe("5");
      expect(result.globalParams.Daemon).toBe("Off");
      expect(result.globalParams.Log_Level).toBe("info");
      expect(result.globalParams.Parsers_File).toBe("parsers.conf");
    });

    it("collects @INCLUDE directives", () => {
      expect(result.includes).toEqual(["inputs.conf"]);
    });

    it("computes complexity metrics in the FluentD IR shape", () => {
      expect(result.complexity.totalBlocks).toBe(4);
      expect(result.complexity.uniquePlugins).toEqual(
        expect.arrayContaining(["tail", "systemd", "kubernetes", "es"]),
      );
      expect(result.complexity.uniquePlugins).toHaveLength(4);
      // Distinct Match patterns on the FILTER + OUTPUT: "kube.*" and "*".
      expect(result.complexity.routingBranches).toBe(2);
      // Fluent Bit has no Ruby expressions or nested sub-sections.
      expect(result.complexity.rubyExpressionCount).toBe(0);
      expect(result.complexity.nestedBlockDepth).toBe(1);
      expect(result.complexity.includeCount).toBe(1);
    });

    it("preserves each block's raw text for AI context", () => {
      expect(result.blocks[0].rawText).toContain("[INPUT]");
      expect(result.blocks[0].rawText).toContain("Name");
    });
  });

  describe("downstream consumption", () => {
    it("produces an IR the existing readiness service consumes", () => {
      const parsed = parseFluentbitConfig(REPRESENTATIVE_CONFIG);
      const report = computeReadiness(parsed);

      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
      // Inventory keys off blockType:pluginType, so every block is accounted for.
      const inventoried = report.pluginInventory.reduce((sum, p) => sum + p.count, 0);
      expect(inventoried).toBe(4);
      expect(report.pluginInventory.map((p) => p.pluginType)).toEqual(
        expect.arrayContaining(["tail", "systemd", "kubernetes", "es"]),
      );
    });
  });

  describe("case-insensitive sections and keys", () => {
    it("recognizes lowercase section names and the Name/Match keys", () => {
      const config = `
[input]
    name tail
    path /var/log/app.log

[output]
    name stdout
    match app.*
`;
      const result = parseFluentbitConfig(config);

      expect(result.blocks).toHaveLength(2);
      expect(result.blocks[0].blockType).toBe("source");
      expect(result.blocks[0].pluginType).toBe("tail");
      expect(result.blocks[0].params.path).toBe("/var/log/app.log");
      expect(result.blocks[1].blockType).toBe("match");
      expect(result.blocks[1].pluginType).toBe("stdout");
      expect(result.blocks[1].tagPattern).toBe("app.*");
    });
  });

  describe("comments, quotes, and empty config", () => {
    it("ignores # and ; comment lines", () => {
      const config = `
; daemon comment
[INPUT]
    # plugin selector
    Name dummy
    Rate 1
`;
      const result = parseFluentbitConfig(config);

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].pluginType).toBe("dummy");
      expect(result.blocks[0].params.Rate).toBe("1");
    });

    it("strips surrounding quotes from values", () => {
      const config = `
[FILTER]
    Name  grep
    Match *
    Regex "level (ERROR|WARN)"
`;
      const result = parseFluentbitConfig(config);

      expect(result.blocks[0].params.Regex).toBe("level (ERROR|WARN)");
    });

    it("returns an empty IR for an empty config", () => {
      const result = parseFluentbitConfig("");

      expect(result.blocks).toHaveLength(0);
      expect(result.includes).toHaveLength(0);
      expect(result.complexity.totalBlocks).toBe(0);
      expect(result.complexity.uniquePlugins).toHaveLength(0);
      expect(result.complexity.routingBranches).toBe(0);
      expect(result.complexity.nestedBlockDepth).toBe(0);
    });
  });
});
