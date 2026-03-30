// src/app/api/sse/__tests__/sse-max-connections.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("SSE_MAX_CONNECTIONS default", () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear any env override so we test the default
    delete process.env.SSE_MAX_CONNECTIONS;
  });

  it("defaults to 5000 when SSE_MAX_CONNECTIONS env var is not set", async () => {
    // We need to read the source and verify the default.
    // Since the constant is module-scoped, we test it by importing fresh.
    // The SSE route uses `parseInt(process.env.SSE_MAX_CONNECTIONS ?? "5000", 10)`
    // We verify by checking the source file contains the right default.
    const fs = await import("fs");
    const path = await import("path");
    const routeSource = fs.readFileSync(
      path.resolve("src/app/api/sse/route.ts"),
      "utf-8",
    );
    expect(routeSource).toContain('?? "5000"');
    expect(routeSource).not.toContain('?? "1000"');
  });
});
