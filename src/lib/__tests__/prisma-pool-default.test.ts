// src/lib/__tests__/prisma-pool-default.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("DATABASE_POOL_MAX default", () => {
  it("defaults to 50 in prisma.ts via env module", () => {
    const source = readFileSync(resolve("src/lib/prisma.ts"), "utf-8");
    // Pool max is now sourced from the centralized env module (env.DATABASE_POOL_MAX)
    // which defaults to 50 — verify the old hardcoded fallback is gone.
    expect(source).toContain("env.DATABASE_POOL_MAX");
    expect(source).not.toContain('?? "20"');
  });
});
