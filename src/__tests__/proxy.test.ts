import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("proxy matcher", () => {
  it("does not guard tRPC, Next.js dev assets, or font endpoints", () => {
    const source = readFileSync(resolve(process.cwd(), "src/proxy.ts"), "utf8");
    expect(source).toContain("api/trpc");
    expect(source).toContain("_next/webpack-hmr");
    expect(source).toContain("__nextjs_font");
  });
});
