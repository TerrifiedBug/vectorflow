import { describe, it, expect } from "vitest";
import {
  parseVarRef,
  makeVarRef,
  collectVarRefs,
  resolveVarRefs,
} from "../variable-resolver";

describe("variable-resolver", () => {
  describe("parseVarRef", () => {
    it("parses VAR[name] correctly", () => {
      expect(parseVarRef("VAR[index_name]")).toBe("index_name");
    });

    it("returns null for non-var strings", () => {
      expect(parseVarRef("hello")).toBeNull();
      expect(parseVarRef("SECRET[foo]")).toBeNull();
      expect(parseVarRef("")).toBeNull();
    });

    it("handles names with special chars", () => {
      expect(parseVarRef("VAR[my_var_123]")).toBe("my_var_123");
    });
  });

  describe("makeVarRef", () => {
    it("creates VAR[name] string", () => {
      expect(makeVarRef("index_name")).toBe("VAR[index_name]");
    });
  });

  describe("collectVarRefs", () => {
    it("collects refs from flat config", () => {
      const config = {
        host: "localhost",
        index: "VAR[index_name]",
        port: 9200,
      };

      expect(collectVarRefs(config)).toEqual(new Set(["index_name"]));
    });

    it("collects refs from nested config", () => {
      const config = {
        endpoint: "VAR[opensearch_endpoint]",
        auth: {
          user: "admin",
          token: "SECRET[api_token]",
        },
        output: {
          index: "VAR[index_name]",
        },
      };

      const refs = collectVarRefs(config);

      expect(refs).toEqual(new Set(["opensearch_endpoint", "index_name"]));
    });

    it("returns empty set when no refs", () => {
      expect(collectVarRefs({ host: "localhost" })).toEqual(new Set());
    });

    it("deduplicates refs", () => {
      const config = {
        a: "VAR[foo]",
        b: "VAR[foo]",
      };

      expect(collectVarRefs(config)).toEqual(new Set(["foo"]));
    });
  });

  describe("resolveVarRefs", () => {
    it("resolves from pipeline vars", () => {
      const config = { index: "VAR[index_name]" };
      const pipelineVars = { index_name: "app-logs-prod" };
      const envVars = new Map<string, string>();

      const result = resolveVarRefs(config, pipelineVars, envVars);

      expect(result).toEqual({ index: "app-logs-prod" });
    });

    it("falls back to env vars", () => {
      const config = { endpoint: "VAR[opensearch_endpoint]" };
      const pipelineVars = {};
      const envVars = new Map([["opensearch_endpoint", "https://search:9200"]]);

      const result = resolveVarRefs(config, pipelineVars, envVars);

      expect(result).toEqual({ endpoint: "https://search:9200" });
    });

    it("pipeline var shadows env var", () => {
      const config = { region: "VAR[region]" };
      const pipelineVars = { region: "eu-west-1" };
      const envVars = new Map([["region", "us-east-1"]]);

      const result = resolveVarRefs(config, pipelineVars, envVars);

      expect(result).toEqual({ region: "eu-west-1" });
    });

    it("throws for unresolved var", () => {
      const config = { index: "VAR[missing_var]" };

      expect(() => resolveVarRefs(config, {}, new Map())).toThrow("missing_var");
    });

    it("preserves non-var values", () => {
      const config = {
        host: "localhost",
        index: "VAR[index_name]",
        port: 9200,
        enabled: true,
      };

      const result = resolveVarRefs(config, { index_name: "logs" }, new Map());

      expect(result).toEqual({
        host: "localhost",
        index: "logs",
        port: 9200,
        enabled: true,
      });
    });

    it("resolves nested configs", () => {
      const config = {
        output: {
          index: "VAR[index_name]",
          endpoint: "VAR[endpoint]",
        },
      };
      const pipelineVars = { index_name: "logs" };
      const envVars = new Map([["endpoint", "https://es:9200"]]);

      const result = resolveVarRefs(config, pipelineVars, envVars);

      expect(result).toEqual({
        output: {
          index: "logs",
          endpoint: "https://es:9200",
        },
      });
    });

    it("VAR + SECRET refs coexist without interference", () => {
      const config = {
        endpoint: "VAR[opensearch_endpoint]",
        token: "SECRET[api_token]",
        cert: "CERT[ca_cert]",
      };
      const pipelineVars = { opensearch_endpoint: "https://search:9200" };

      const result = resolveVarRefs(config, pipelineVars, new Map());

      expect(result).toEqual({
        endpoint: "https://search:9200",
        token: "SECRET[api_token]",
        cert: "CERT[ca_cert]",
      });
    });
  });
});
