import { describe, it, expect } from "vitest";
import { parseVectorConfig, detectSubgraphs } from "@/lib/config-generator";

// ── Test 1: Multi-path YAML — two independent pipelines ────────────────────

const YAML_MULTI_PATH = `
api:
  enabled: true
  address: "127.0.0.1:8686"

sources:
  http_in:
    type: http_server
    address: "0.0.0.0:8080"

  file_in:
    type: file
    include:
      - "/var/log/app/*.log"

transforms:
  remap_http:
    type: remap
    inputs:
      - http_in
    source: '.env = "prod"'

sinks:
  es_out:
    type: elasticsearch
    inputs:
      - remap_http
    endpoints:
      - "https://es.example.com:9200"
    bulk:
      index: "logs-%Y.%m.%d"

  s3_out:
    type: aws_s3
    inputs:
      - file_in
    bucket: "my-log-bucket"
    region: "us-east-1"
    key_prefix: "logs/"
`;

// ── Test 2: Monolithic fully-connected linear config ───────────────────────

const YAML_LINEAR = `
sources:
  file_src:
    type: file
    include:
      - "/var/log/*.log"

transforms:
  remap_t:
    type: remap
    inputs:
      - file_src
    source: ".host = get_hostname!()"

  filter_t:
    type: filter
    inputs:
      - remap_t
    condition: '.level == "error"'

sinks:
  console_out:
    type: console
    inputs:
      - filter_t
    encoding:
      codec: json
`;

// ── Test 3: TOML format end-to-end ─────────────────────────────────────────

const TOML_SYSLOG_SPLUNK = `
[sources.syslog_in]
type = "syslog"
address = "0.0.0.0:514"
mode = "udp"

[sinks.splunk_out]
type = "splunk_hec_logs"
inputs = ["syslog_in"]
endpoint = "https://splunk.example.com:8088"
token = "abc123"
`;

// ── Test 4: Shared transform — one source, one transform, two sinks ────────

const YAML_SHARED_TRANSFORM = `
sources:
  app_logs:
    type: file
    include:
      - "/var/log/app.log"

transforms:
  shared_remap:
    type: remap
    inputs:
      - app_logs
    source: ".processed = true"

sinks:
  console_sink:
    type: console
    inputs:
      - shared_remap
    encoding:
      codec: json

  s3_sink:
    type: aws_s3
    inputs:
      - shared_remap
    bucket: "archive-bucket"
    region: "eu-west-1"
    key_prefix: "archive/"
`;

// ── Test 5: Multi-pipeline with orphan source ──────────────────────────────

const YAML_WITH_ORPHAN = `
sources:
  connected_src:
    type: file
    include:
      - "/var/log/app.log"

  orphan_src:
    type: http_server
    address: "0.0.0.0:9999"

sinks:
  main_sink:
    type: console
    inputs:
      - connected_src
    encoding:
      codec: json
`;

// ── Integration tests ──────────────────────────────────────────────────────

describe("Vector migration integration — parse → detect", () => {
  describe("Test 1: two independent pipelines from a multi-path YAML config", () => {
    it("parses 4 components and extracts globalConfig", () => {
      const result = parseVectorConfig(YAML_MULTI_PATH);

      expect(result.components).toHaveLength(5);
      expect(result.globalConfig).not.toBeNull();
      expect(result.globalConfig).toHaveProperty("api");
    });

    it("detects 2 subgraphs with correct component grouping", () => {
      const { components } = parseVectorConfig(YAML_MULTI_PATH);
      const { subgraphs } = detectSubgraphs(components);

      expect(subgraphs).toHaveLength(2);

      // Collect all component keys across both subgraphs
      const allKeys = subgraphs.flatMap((sg) => sg.components.map((c) => c.componentKey));
      expect(allKeys).toContain("http_in");
      expect(allKeys).toContain("remap_http");
      expect(allKeys).toContain("es_out");
      expect(allKeys).toContain("file_in");
      expect(allKeys).toContain("s3_out");

      // http_in → remap_http → es_out must be in the same subgraph
      const httpPipeline = subgraphs.find((sg) =>
        sg.components.some((c) => c.componentKey === "http_in"),
      );
      expect(httpPipeline).toBeDefined();
      const httpKeys = httpPipeline!.components.map((c) => c.componentKey);
      expect(httpKeys).toContain("remap_http");
      expect(httpKeys).toContain("es_out");

      // file_in → s3_out must be in the same subgraph
      const filePipeline = subgraphs.find((sg) =>
        sg.components.some((c) => c.componentKey === "file_in"),
      );
      expect(filePipeline).toBeDefined();
      const fileKeys = filePipeline!.components.map((c) => c.componentKey);
      expect(fileKeys).toContain("s3_out");
    });
  });

  describe("Test 2: monolithic fully-connected config as one pipeline", () => {
    it("detects exactly 1 subgraph for a linear chain", () => {
      const { components } = parseVectorConfig(YAML_LINEAR);
      const { subgraphs } = detectSubgraphs(components, "my-pipeline.yaml");

      expect(subgraphs).toHaveLength(1);
      expect(subgraphs[0].components).toHaveLength(4);
    });

    it("uses filename fallback for name when there is one subgraph", () => {
      const { components } = parseVectorConfig(YAML_LINEAR);
      const { subgraphs } = detectSubgraphs(components, "my-pipeline.yaml");

      expect(subgraphs[0].suggestedName).toBe("my-pipeline");
    });
  });

  describe("Test 3: TOML format end-to-end", () => {
    it("parses TOML config without error", () => {
      const result = parseVectorConfig(TOML_SYSLOG_SPLUNK);

      expect(result.components).toHaveLength(2);

      const source = result.components.find((c) => c.kind === "source");
      expect(source?.componentType).toBe("syslog");
      expect(source?.componentKey).toBe("syslog_in");

      const sink = result.components.find((c) => c.kind === "sink");
      expect(sink?.componentType).toBe("splunk_hec_logs");
      expect(sink?.componentKey).toBe("splunk_out");
    });

    it("detects subgraphs from TOML-parsed components with auto-generated name", () => {
      const { components } = parseVectorConfig(TOML_SYSLOG_SPLUNK);
      const { subgraphs } = detectSubgraphs(components);

      expect(subgraphs).toHaveLength(1);
      // Name is generated from source→sink types with underscores replaced by hyphens
      expect(subgraphs[0].suggestedName).toBe("syslog-to-splunk-hec-logs");
    });
  });

  describe("Test 4: shared transform keeps everything in one subgraph", () => {
    it("does not split when a transform is shared by two sinks", () => {
      const { components } = parseVectorConfig(YAML_SHARED_TRANSFORM);
      const { subgraphs } = detectSubgraphs(components);

      expect(subgraphs).toHaveLength(1);
      expect(subgraphs[0].components).toHaveLength(4);

      const keys = subgraphs[0].components.map((c) => c.componentKey);
      expect(keys).toContain("app_logs");
      expect(keys).toContain("shared_remap");
      expect(keys).toContain("console_sink");
      expect(keys).toContain("s3_sink");
    });
  });

  describe("Test 5: orphan warnings in a multi-pipeline config", () => {
    it("emits a warning for the orphan source", () => {
      const { warnings } = parseVectorConfig(YAML_WITH_ORPHAN);

      expect(warnings.some((w) => w.includes("orphan_src"))).toBe(true);
    });

    it("does not warn about connected components", () => {
      const { warnings } = parseVectorConfig(YAML_WITH_ORPHAN);

      expect(warnings.some((w) => w.includes("connected_src"))).toBe(false);
      expect(warnings.some((w) => w.includes("main_sink"))).toBe(false);
    });

    it("detects the connected pipeline as a subgraph", () => {
      const { components } = parseVectorConfig(YAML_WITH_ORPHAN);
      const { subgraphs } = detectSubgraphs(components);

      // connected_src → main_sink is one subgraph; orphan_src is another
      expect(subgraphs).toHaveLength(2);

      const connectedPipeline = subgraphs.find((sg) =>
        sg.components.some((c) => c.componentKey === "connected_src"),
      );
      expect(connectedPipeline).toBeDefined();
      const connectedKeys = connectedPipeline!.components.map((c) => c.componentKey);
      expect(connectedKeys).toContain("main_sink");

      const orphanSubgraph = subgraphs.find((sg) =>
        sg.components.some((c) => c.componentKey === "orphan_src"),
      );
      expect(orphanSubgraph).toBeDefined();
      expect(orphanSubgraph!.components).toHaveLength(1);
    });
  });
});
