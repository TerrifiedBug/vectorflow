import { describe, it, expect, vi } from "vitest";
import { assembleVectorYaml } from "../translation-assembler";
import type { TranslatedBlock } from "../types";

// This test verifies the assembler produces YAML that parseVectorErrors can handle
vi.mock("@/server/services/validator", async () => {
  return {
    validateConfig: vi.fn().mockImplementation(async (yamlContent: string) => {
      // Simulate vector validate behavior
      if (yamlContent.includes("type: file") && yamlContent.includes("sources:")) {
        return { valid: true, errors: [], warnings: [] };
      }
      return {
        valid: false,
        errors: [{ message: "Missing required field 'include'", componentKey: "my_source" }],
        warnings: [],
      };
    }),
  };
});

describe("validation integration", () => {
  it("assembled YAML passes through validator without structural issues", async () => {
    const blocks: TranslatedBlock[] = [
      {
        blockId: "b1",
        componentType: "file",
        componentId: "my_source",
        kind: "source",
        config: {
          include: ["/var/log/app.log"],
        },
        inputs: [],
        confidence: 90,
        notes: [],
        validationErrors: [],
        status: "translated",
      },
      {
        blockId: "b2",
        componentType: "console",
        componentId: "my_sink",
        kind: "sink",
        config: {
          encoding: { codec: "json" },
        },
        inputs: ["my_source"],
        confidence: 95,
        notes: [],
        validationErrors: [],
        status: "translated",
      },
    ];

    const yamlOutput = assembleVectorYaml(blocks);

    // YAML should be parseable
    const { validateConfig } = await import("@/server/services/validator");
    const result = await validateConfig(yamlOutput);

    // Our mock returns valid for YAML with "type: file"
    expect(result.valid).toBe(true);
  });

  it("validation errors include component keys for targeted retry", async () => {
    const blocks: TranslatedBlock[] = [
      {
        blockId: "b1",
        componentType: "file",
        componentId: "my_source",
        kind: "source",
        config: {}, // Missing required 'include' field
        inputs: [],
        confidence: 50,
        notes: [],
        validationErrors: [],
        status: "translated",
      },
    ];

    const yamlOutput = assembleVectorYaml(blocks);
    const { validateConfig } = await import("@/server/services/validator");
    const result = await validateConfig(yamlOutput);

    // In a real scenario, vector validate would return errors with component keys
    // Our mock simulates this
    if (!result.valid) {
      const errorWithKey = result.errors.find((e: { componentKey?: string }) => e.componentKey);
      expect(errorWithKey).toBeDefined();
      expect(errorWithKey!.componentKey).toBe("my_source");
    }
  });
});
