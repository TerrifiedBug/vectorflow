import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => { const __pm = { $queryRaw: vi.fn() }; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });
vi.mock("@/server/services/kms", () => ({
  getKmsProvider: vi.fn(),
}));
vi.mock("@/server/services/clock-skew", () => ({
  checkClockSkew: vi.fn(),
}));

import { GET } from "../route";
import { prisma } from "@/lib/prisma";
import { getKmsProvider } from "@/server/services/kms";
import { checkClockSkew } from "@/server/services/clock-skew";

describe("/api/health/deep — DB probe bounded by timeout", () => {
  beforeEach(() => {
    vi.mocked(getKmsProvider).mockReturnValue({
      healthCheck: async () => ({ ok: true, keyId: "ok" }),
      describeKey: () => ({ provider: "local-dev", keyId: "ok" }),
    } as never);
    vi.mocked(checkClockSkew).mockResolvedValue({
      ok: true,
      skewSeconds: 0,
      thresholdSeconds: 2,
      message: "ok",
    });
  });
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 503 with database.detail=timed-out when the DB query hangs", async () => {
    vi.mocked(prisma.$queryRaw).mockImplementation(
      () => new Promise(() => {}) as never,
    );
    const start = Date.now();
    const res = await GET();
    const elapsed = Date.now() - start;
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.database.detail).toMatch(/timed?\s?out|budget/i);
    expect(elapsed).toBeLessThan(2000);
  });
});
