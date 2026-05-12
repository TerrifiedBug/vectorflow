import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function getProxyMatcherSource() {
  const source = readFileSync(resolve(process.cwd(), "src/proxy.ts"), "utf8");
  const match = source.match(/matcher:\s*\[\s*"([^"]+)"/);

  expect(match?.[1]).toBeTypeOf("string");
  return match![1];
}

function matchesProxy(pathname: string) {
  return new RegExp(`^${getProxyMatcherSource()}$`).test(pathname);
}

describe("proxy matcher", () => {
  it("does not guard tRPC, Next.js dev assets, font endpoints, or backup APIs", () => {
    expect(matchesProxy("/api/trpc/pipeline.list")).toBe(false);
    expect(matchesProxy("/_next/webpack-hmr")).toBe(false);
    expect(matchesProxy("/__nextjs_font/inter.css")).toBe(false);
    expect(matchesProxy("/api/backups/upload")).toBe(false);
  });
});
