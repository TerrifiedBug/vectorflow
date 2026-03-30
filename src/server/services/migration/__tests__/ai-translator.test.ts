import { describe, it, expect, vi } from "vitest";
import type { TranslatedBlock } from "../types";
import { assembleVectorYaml } from "../translation-assembler";

// Mock external dependencies for unit testing
vi.mock("@/server/services/ai", () => ({
  getTeamAiConfig: vi.fn().mockResolvedValue({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-4o",
  }),
}));

vi.mock("@/lib/ai/rate-limiter", () => ({
  checkRateLimit: vi.fn().mockReturnValue({
    allowed: true,
    remaining: 59,
    resetAt: Date.now() + 3600000,
  }),
}));

vi.mock("@/server/services/validator", () => ({
  validateConfig: vi.fn().mockResolvedValue({
    valid: true,
    errors: [],
    warnings: [],
  }),
}));

describe("assembleVectorYaml", () => {
  it("assembles translated blocks into valid YAML", () => {
    const blocks: TranslatedBlock[] = [
      {
        blockId: "b1",
        componentType: "file",
        componentId: "nginx_logs",
        kind: "source",
        config: {
          include: ["/var/log/nginx/access.log"],
          read_from: "beginning",
        },
        inputs: [],
        confidence: 90,
        notes: [],
        validationErrors: [],
        status: "translated",
      },
      {
        blockId: "b2",
        componentType: "remap",
        componentId: "parse_nginx",
        kind: "transform",
        config: {
          source: '. = parse_json!(.message)',
        },
        inputs: ["nginx_logs"],
        confidence: 85,
        notes: [],
        validationErrors: [],
        status: "translated",
      },
      {
        blockId: "b3",
        componentType: "elasticsearch",
        componentId: "es_sink",
        kind: "sink",
        config: {
          endpoints: ["http://es-host:9200"],
          index: "k8s-logs-%Y.%m.%d",
        },
        inputs: ["parse_nginx"],
        confidence: 88,
        notes: [],
        validationErrors: [],
        status: "translated",
      },
    ];

    const yamlOutput = assembleVectorYaml(blocks);

    expect(yamlOutput).toContain("sources:");
    expect(yamlOutput).toContain("nginx_logs:");
    expect(yamlOutput).toContain("transforms:");
    expect(yamlOutput).toContain("parse_nginx:");
    expect(yamlOutput).toContain("sinks:");
    expect(yamlOutput).toContain("es_sink:");
    expect(yamlOutput).toContain("inputs:");
  });

  it("skips failed blocks", () => {
    const blocks: TranslatedBlock[] = [
      {
        blockId: "b1",
        componentType: "file",
        componentId: "nginx_logs",
        kind: "source",
        config: { include: ["/var/log/app.log"] },
        inputs: [],
        confidence: 90,
        notes: [],
        validationErrors: [],
        status: "translated",
      },
      {
        blockId: "b2",
        componentType: "unknown",
        componentId: "failed_block",
        kind: "transform",
        config: {},
        inputs: [],
        confidence: 0,
        notes: ["Translation failed"],
        validationErrors: [],
        status: "failed",
      },
    ];

    const yamlOutput = assembleVectorYaml(blocks);

    expect(yamlOutput).toContain("nginx_logs:");
    expect(yamlOutput).not.toContain("failed_block:");
  });

  it("returns empty config for no blocks", () => {
    const yamlOutput = assembleVectorYaml([]);
    // Should be an empty or near-empty YAML
    expect(yamlOutput.trim()).toBe("{}");
  });

  it("adds type field to each component", () => {
    const blocks: TranslatedBlock[] = [
      {
        blockId: "b1",
        componentType: "file",
        componentId: "my_source",
        kind: "source",
        config: { include: ["/var/log/app.log"] },
        inputs: [],
        confidence: 90,
        notes: [],
        validationErrors: [],
        status: "translated",
      },
    ];

    const yamlOutput = assembleVectorYaml(blocks);

    expect(yamlOutput).toContain("type: file");
  });
});
