import { describe, it, expect } from "vitest";
import { parseVectorConfig } from "../vector-parser";

// ── YAML fixtures ──────────────────────────────────────────────────────────

const YAML_BASIC = `
sources:
  my_http:
    type: http_server
    address: "0.0.0.0:8080"

transforms:
  my_remap:
    type: remap
    inputs:
      - my_http
    source: ".foo = 1"

sinks:
  my_stdout:
    type: console
    inputs:
      - my_remap
    encoding:
      codec: json
`;

const YAML_WITH_GLOBAL = `
api:
  enabled: true
  address: "127.0.0.1:8686"

sources:
  stdin_source:
    type: stdin

sinks:
  console_sink:
    type: console
    inputs:
      - stdin_source
    encoding:
      codec: text
`;

const YAML_BEARER_AUTH = `
sources:
  my_http:
    type: http_server
    address: "0.0.0.0:8080"
    request:
      headers:
        Authorization: "Bearer my-secret-token"
`;

const YAML_BASIC_AUTH = `
sources:
  my_http:
    type: http_server
    address: "0.0.0.0:8080"
    request:
      headers:
        Authorization: "Basic dXNlcjpwYXNz"
`;

const YAML_DEPRECATED_FINGERPRINTING = `
sources:
  my_file:
    type: file
    include:
      - "/var/log/*.log"
    fingerprinting:
      strategy: checksum
`;

const YAML_ORPHAN = `
sources:
  connected_source:
    type: stdin

  orphan_source:
    type: http_server
    address: "0.0.0.0:9000"

transforms:
  orphan_transform:
    type: remap
    inputs:
      - connected_source
    source: ".x = 1"

sinks:
  my_sink:
    type: console
    inputs:
      - connected_source
    encoding:
      codec: text
`;

// ── TOML fixtures ──────────────────────────────────────────────────────────

const TOML_BASIC = `
[sources.my_file]
type = "file"
include = ["/var/log/*.log"]

[transforms.my_remap]
type = "remap"
inputs = ["my_file"]
source = ".foo = 1"

[sinks.my_console]
type = "console"
inputs = ["my_remap"]

[sinks.my_console.encoding]
codec = "json"
`;

// ── Tests ──────────────────────────────────────────────────────────────────

describe("parseVectorConfig", () => {
  describe("YAML parsing", () => {
    it("parses sources, transforms, and sinks from YAML", () => {
      const result = parseVectorConfig(YAML_BASIC, "yaml");

      expect(result.components).toHaveLength(3);

      const source = result.components.find((c) => c.kind === "source");
      expect(source).toBeDefined();
      expect(source!.componentKey).toBe("my_http");
      expect(source!.componentType).toBe("http_server");
      expect(source!.inputs).toEqual([]);

      const transform = result.components.find((c) => c.kind === "transform");
      expect(transform).toBeDefined();
      expect(transform!.componentKey).toBe("my_remap");
      expect(transform!.componentType).toBe("remap");
      expect(transform!.inputs).toEqual(["my_http"]);

      const sink = result.components.find((c) => c.kind === "sink");
      expect(sink).toBeDefined();
      expect(sink!.componentKey).toBe("my_stdout");
      expect(sink!.componentType).toBe("console");
      expect(sink!.inputs).toEqual(["my_remap"]);
    });

    it("does not include type or inputs in component config", () => {
      const result = parseVectorConfig(YAML_BASIC, "yaml");
      for (const comp of result.components) {
        expect(comp.config).not.toHaveProperty("type");
        expect(comp.config).not.toHaveProperty("inputs");
      }
    });
  });

  describe("global config extraction", () => {
    it("extracts non-graph sections into globalConfig", () => {
      const result = parseVectorConfig(YAML_WITH_GLOBAL, "yaml");

      expect(result.globalConfig).not.toBeNull();
      expect(result.globalConfig).toHaveProperty("api");
      expect((result.globalConfig as Record<string, unknown>).api).toMatchObject({
        enabled: true,
        address: "127.0.0.1:8686",
      });
    });

    it("returns null globalConfig when no non-graph sections exist", () => {
      const result = parseVectorConfig(YAML_BASIC, "yaml");
      expect(result.globalConfig).toBeNull();
    });
  });

  describe("auth normalization", () => {
    it("normalizes Bearer auth headers into auth block", () => {
      const result = parseVectorConfig(YAML_BEARER_AUTH, "yaml");
      const source = result.components.find((c) => c.componentKey === "my_http");

      expect(source).toBeDefined();
      expect(source!.config.auth).toEqual({
        strategy: "bearer",
        token: "my-secret-token",
      });
      // Authorization header should be removed
      const request = source!.config.request as Record<string, unknown> | undefined;
      expect(request).toBeUndefined();
    });

    it("normalizes Basic auth headers into auth block with decoded credentials", () => {
      const result = parseVectorConfig(YAML_BASIC_AUTH, "yaml");
      const source = result.components.find((c) => c.componentKey === "my_http");

      expect(source).toBeDefined();
      expect(source!.config.auth).toEqual({
        strategy: "basic",
        user: "user",
        password: "pass",
      });
    });
  });

  describe("deprecated field renames", () => {
    it("renames deprecated fingerprinting to fingerprint on sources", () => {
      const result = parseVectorConfig(YAML_DEPRECATED_FINGERPRINTING, "yaml");
      const source = result.components.find((c) => c.kind === "source");

      expect(source).toBeDefined();
      expect(source!.config).not.toHaveProperty("fingerprinting");
      expect(source!.config).toHaveProperty("fingerprint");
      expect(source!.config.fingerprint).toMatchObject({ strategy: "checksum" });
    });

    it("does not rename fingerprinting on transforms or sinks", () => {
      // fingerprinting rename is source-only; a transform with that field keeps it
      const yaml = `
transforms:
  t:
    type: remap
    inputs: []
    fingerprinting: keep_me
`;
      const result = parseVectorConfig(yaml, "yaml");
      const transform = result.components.find((c) => c.kind === "transform");
      expect(transform!.config).toHaveProperty("fingerprinting", "keep_me");
      expect(transform!.config).not.toHaveProperty("fingerprint");
    });
  });

  describe("empty / invalid input", () => {
    it("throws when given an empty string", () => {
      expect(() => parseVectorConfig("")).toThrow();
    });

    it("throws when given only whitespace", () => {
      expect(() => parseVectorConfig("   \n  ")).toThrow();
    });
  });

  describe("orphan warnings", () => {
    it("adds warnings for sources with no downstream consumers", () => {
      const result = parseVectorConfig(YAML_ORPHAN, "yaml");

      const warnings = result.warnings;
      expect(warnings.some((w) => w.includes("orphan_source"))).toBe(true);
    });

    it("adds warnings for sinks with no upstream inputs", () => {
      const yaml = `
sources:
  s:
    type: stdin
sinks:
  orphan_sink:
    type: console
    encoding:
      codec: text
`;
      const result = parseVectorConfig(yaml, "yaml");
      expect(result.warnings.some((w) => w.includes("orphan_sink"))).toBe(true);
    });

    it("does not warn about connected components", () => {
      const result = parseVectorConfig(YAML_BASIC, "yaml");
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("catalog matching", () => {
    it("sets catalogMatch true for known component types", () => {
      const result = parseVectorConfig(YAML_BASIC, "yaml");
      // remap and console are well-known catalog entries
      const remap = result.components.find((c) => c.componentType === "remap");
      const consoleSink = result.components.find((c) => c.componentType === "console");
      expect(remap?.catalogMatch).toBe(true);
      expect(consoleSink?.catalogMatch).toBe(true);
    });

    it("sets catalogMatch false for unknown component types", () => {
      const yaml = `
sources:
  unknown_src:
    type: totally_unknown_type_xyz
`;
      const result = parseVectorConfig(yaml, "yaml");
      const comp = result.components.find((c) => c.componentKey === "unknown_src");
      expect(comp?.catalogMatch).toBe(false);
    });
  });

  describe("TOML parsing", () => {
    it("parses sources, transforms, and sinks from TOML", () => {
      const result = parseVectorConfig(TOML_BASIC, "toml");

      expect(result.components).toHaveLength(3);

      const source = result.components.find((c) => c.kind === "source");
      expect(source).toBeDefined();
      expect(source!.componentKey).toBe("my_file");
      expect(source!.componentType).toBe("file");

      const transform = result.components.find((c) => c.kind === "transform");
      expect(transform).toBeDefined();
      expect(transform!.componentKey).toBe("my_remap");
      expect(transform!.inputs).toEqual(["my_file"]);

      const sink = result.components.find((c) => c.kind === "sink");
      expect(sink).toBeDefined();
      expect(sink!.componentKey).toBe("my_console");
    });

    it("does not include type or inputs in component config for TOML", () => {
      const result = parseVectorConfig(TOML_BASIC, "toml");
      for (const comp of result.components) {
        expect(comp.config).not.toHaveProperty("type");
        expect(comp.config).not.toHaveProperty("inputs");
      }
    });
  });

  describe("format auto-detection", () => {
    it("auto-detects YAML when format is not specified", () => {
      const result = parseVectorConfig(YAML_BASIC);
      expect(result.components).toHaveLength(3);
    });

    it("auto-detects TOML when format is not specified and input uses [section.key] headers", () => {
      const result = parseVectorConfig(TOML_BASIC);
      expect(result.components).toHaveLength(3);
      expect(result.components.find((c) => c.componentKey === "my_file")).toBeDefined();
    });
  });
});
