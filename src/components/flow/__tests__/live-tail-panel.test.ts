import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const liveTailSource = readFileSync("src/components/flow/live-tail-panel.tsx", "utf8");

describe("LiveTailPanel layout", () => {
  it("uses a wider resizable dock instead of the old fixed box", () => {
    expect(liveTailSource).toContain("left-3 right-3");
    expect(liveTailSource).toContain("max-w-[720px]");
    expect(liveTailSource).toContain("resize-y");
    expect(liveTailSource).not.toContain("w-[360px]");
    expect(liveTailSource).not.toContain("h-[140px]");
  });

  it("supports expansion for smaller screens", () => {
    expect(liveTailSource).toContain("Expand live tail");
    expect(liveTailSource).toContain("Collapse live tail");
    expect(liveTailSource).toContain('expanded ? "h-[320px]" : "h-[180px]"');
  });
});
