import { describe, it, expect, vi } from "vitest";
import { buildBlockTranslationPrompt, buildMigrationSystemPrompt } from "../prompt-builder";
import { parseFluentdConfig } from "../fluentd-parser";

// Mock the vector catalog to avoid importing the full catalog in tests
vi.mock("@/lib/vector/catalog", () => ({
  getVectorCatalog: () => [
    {
      type: "file",
      kind: "source",
      displayName: "File",
      description: "Read logs from files",
      category: "Local",
      outputTypes: ["log"],
      configSchema: {
        type: "object",
        properties: {
          include: { type: "array", description: "File paths to include" },
        },
        required: ["include"],
      },
    },
    {
      type: "elasticsearch",
      kind: "sink",
      displayName: "Elasticsearch",
      description: "Send logs to Elasticsearch",
      category: "Search",
      outputTypes: ["log"],
      configSchema: {
        type: "object",
        properties: {
          endpoints: { type: "array", description: "ES endpoints" },
        },
        required: ["endpoints"],
      },
    },
    {
      type: "remap",
      kind: "transform",
      displayName: "Remap (VRL)",
      description: "Transform events using VRL",
      category: "General",
      inputTypes: ["log"],
      outputTypes: ["log"],
      configSchema: {
        type: "object",
        properties: {
          source: { type: "string", description: "VRL program" },
        },
        required: ["source"],
      },
    },
  ],
}));

describe("buildBlockTranslationPrompt", () => {
  it("includes block type and plugin info", async () => {
    const config = `
<source>
  @type tail
  path /var/log/app.log
  tag app.logs
</source>`;

    const parsed = parseFluentdConfig(config);
    const prompt = await buildBlockTranslationPrompt({
      block: parsed.blocks[0],
      blockIndex: 0,
      totalBlocks: 1,
      parsedConfig: parsed,
    });

    expect(prompt).toContain("FluentD Block (1 of 1)");
    expect(prompt).toContain("Plugin: tail");
    expect(prompt).toContain("path: /var/log/app.log");
  });

  it("includes Ruby expression warnings", async () => {
    const config = `
<source>
  @type tail
  path "#{ENV['LOG_PATH']}/access.log"
</source>`;

    const parsed = parseFluentdConfig(config);
    const prompt = await buildBlockTranslationPrompt({
      block: parsed.blocks[0],
      blockIndex: 0,
      totalBlocks: 1,
      parsedConfig: parsed,
    });

    expect(prompt).toContain("Ruby expressions found");
    expect(prompt).toContain("#{ENV['LOG_PATH']}");
  });

  it("includes known mapping hints", async () => {
    const config = `
<source>
  @type tail
  path /var/log/app.log
</source>`;

    const parsed = parseFluentdConfig(config);
    const prompt = await buildBlockTranslationPrompt({
      block: parsed.blocks[0],
      blockIndex: 0,
      totalBlocks: 1,
      parsedConfig: parsed,
    });

    expect(prompt).toContain("Known Mapping Hint");
    expect(prompt).toContain('"file"');
  });

  it("includes Vector component suggestions", async () => {
    const config = `
<match **>
  @type elasticsearch
  host es-host
</match>`;

    const parsed = parseFluentdConfig(config);
    const prompt = await buildBlockTranslationPrompt({
      block: parsed.blocks[0],
      blockIndex: 0,
      totalBlocks: 1,
      parsedConfig: parsed,
    });

    expect(prompt).toContain("Available Vector Components");
    expect(prompt).toContain("elasticsearch");
  });

  it("includes output format instructions", async () => {
    const config = `
<source>
  @type forward
</source>`;

    const parsed = parseFluentdConfig(config);
    const prompt = await buildBlockTranslationPrompt({
      block: parsed.blocks[0],
      blockIndex: 0,
      totalBlocks: 1,
      parsedConfig: parsed,
    });

    expect(prompt).toContain("componentType");
    expect(prompt).toContain("componentId");
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("Translation Rules");
  });
});

describe("buildMigrationSystemPrompt", () => {
  it("returns a non-empty system prompt", async () => {
    const prompt = buildMigrationSystemPrompt();

    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain("FluentD");
    expect(prompt).toContain("Vector");
    expect(prompt).toContain("VRL");
  });
});
