// src/lib/__tests__/prisma-pool-default.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("DATABASE_POOL_MAX default", () => {
  it("defaults to 50 in prisma.ts", () => {
    const source = readFileSync(resolve("src/lib/prisma.ts"), "utf-8");
    expect(source).toContain('?? "50"');
    expect(source).not.toContain('?? "20"');
  });
});
