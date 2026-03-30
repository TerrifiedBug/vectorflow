// docker/server/__tests__/env-example.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe(".env.example documentation", () => {
  const content = readFileSync(
    resolve("docker/server/.env.example"),
    "utf-8",
  );

  it("documents DATABASE_POOL_MAX with default of 50", () => {
    expect(content).toContain("DATABASE_POOL_MAX");
    expect(content).toMatch(/default.*50|50.*default/i);
  });

  it("documents SSE_MAX_CONNECTIONS with default of 5000", () => {
    expect(content).toContain("SSE_MAX_CONNECTIONS");
    expect(content).toMatch(/default.*5000|5000.*default/i);
  });
});
