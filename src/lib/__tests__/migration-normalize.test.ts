import { describe, expect, it } from "vitest";
import { getMigrationTranslationBlocks } from "@/lib/migration-normalize";

describe("getMigrationTranslationBlocks", () => {
  it("accepts the legacy QA seed array shape without throwing", () => {
    const blocks = getMigrationTranslationBlocks([
      { block: "record_transformer", confidence: 0.92 },
    ]);

    expect(blocks).toEqual([{ block: "record_transformer", confidence: 0.92 }]);
  });

  it("accepts the current translation result object shape", () => {
    const blocks = getMigrationTranslationBlocks({
      blocks: [{ blockId: "b1", status: "success", config: { type: "remap" } }],
    });

    expect(blocks).toEqual([{ blockId: "b1", status: "success", config: { type: "remap" } }]);
  });

  it("returns an empty array for null or malformed translation data", () => {
    expect(getMigrationTranslationBlocks(null)).toEqual([]);
    expect(getMigrationTranslationBlocks({ blocks: null })).toEqual([]);
  });
});
