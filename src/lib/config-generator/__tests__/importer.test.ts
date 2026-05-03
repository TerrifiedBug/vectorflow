import { describe, it, expect } from "vitest";
import { generateVectorYaml } from "../yaml-generator";
import { importVectorConfig } from "../importer";

const YAML_BASIC = `
sources:
  http_in:
    type: http
    address: 0.0.0.0:8080
transforms:
  parse:
    type: remap
    inputs: [http_in]
    source: |
      . = parse_json!(.message)
sinks:
  out:
    type: console
    inputs: [parse]
    encoding:
      codec: json
`;

const TOML_BASIC = `
[sources.vglb]
type = "aws_s3"
region = "eu-central-1"
sqs.queue_url = "https://sqs.eu-central-1.amazonaws.com/123/queue"

[transforms.parse_vglb]
type = "remap"
inputs = ["vglb"]
source = '''
.parsed = true
'''

[sinks.vglb_opensearch]
type = "elasticsearch"
inputs = ["parse_vglb"]
endpoints = ["https://example.com"]
auth.strategy = "basic"
auth.user = "fluentd1"
auth.password = "secret"
`;

describe("importVectorConfig", () => {
  it("parses YAML content with explicit format", () => {
    const result = importVectorConfig(YAML_BASIC, "yaml");
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
  });

  it("parses TOML content when format='toml'", () => {
    const result = importVectorConfig(TOML_BASIC, "toml");
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    const kinds = result.nodes.map((n) => n.type).sort();
    expect(kinds).toEqual(["sink", "source", "transform"]);
  });

  it("auto-detects TOML when format omitted", () => {
    const result = importVectorConfig(TOML_BASIC);
    expect(result.nodes).toHaveLength(3);
  });

  it("auto-detects YAML when format omitted", () => {
    const result = importVectorConfig(YAML_BASIC);
    expect(result.nodes).toHaveLength(3);
  });

  it("preserves auth block from TOML dotted-key syntax", () => {
    const result = importVectorConfig(TOML_BASIC, "toml");
    const sink = result.nodes.find((n) => n.type === "sink");
    const auth = (sink?.data as { config: { auth?: { strategy: string } } })
      .config.auth;
    expect(auth?.strategy).toBe("basic");
  });

  it("returns parser warnings for orphaned components", () => {
    const result = importVectorConfig(`
      sources:
        orphan_source:
          type: demo_logs
      sinks:
        orphan_sink:
          type: console
    `);

    expect(result.warnings).toEqual([
      'Orphan source "orphan_source": no downstream consumers reference it',
      'Orphan sink "orphan_sink": no upstream inputs are defined or connected',
    ]);
  });

  it("resolves wildcard inputs so generated YAML keeps sink inputs", () => {
    const result = importVectorConfig(`
      sources:
        demo:
          type: demo_logs
      sinks:
        out:
          type: console
          inputs: ["*"]
        audit:
          type: console
          inputs: ["*"]
    `);

    expect(result.warnings).toEqual([]);
    expect(result.edges).toHaveLength(2);

    const sourceNode = result.nodes.find((node) => node.type === "source");
    const sinkNodes = result.nodes.filter((node) => node.type === "sink");
    for (const sinkNode of sinkNodes) {
      expect(result.edges).toContainEqual(
        expect.objectContaining({
          source: sourceNode?.id,
          target: sinkNode.id,
        }),
      );
    }

    const generatedYaml = generateVectorYaml(result.nodes, result.edges, result.globalConfig);
    expect(generatedYaml).toContain("inputs:\n      - demo");
    expect(generatedYaml).not.toContain("- out");
    expect(generatedYaml).not.toContain("- audit");
  });
});
