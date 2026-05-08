import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("next dev origin config", () => {
  it("allows localhost and 127.0.0.1 for dev resources and disables dev indicators", () => {
    const source = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
    expect(source).toContain("allowedDevOrigins");
    expect(source).toContain("127.0.0.1");
    expect(source).toContain("localhost");
    expect(source).toContain("devIndicators: false");
  });
});
