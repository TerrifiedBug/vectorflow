import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");
const hookSource = readFileSync("src/hooks/use-sse.ts", "utf8");

describe("SSE root mounting", () => {
  it("uses a dedicated root connection hook instead of mounting useSSE subscriptions at the layout root", () => {
    expect(layoutSource).toContain("useSSEConnection()");
    expect(layoutSource).not.toContain("useSSE();");
    expect(hookSource).toContain("export function useSSEConnection()");
  });
});
