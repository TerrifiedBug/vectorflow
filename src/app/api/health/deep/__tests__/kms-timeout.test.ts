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

describe("/api/health/deep — KMS probe bounded by timeout", () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }] as never);
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

  it("returns 503 when KMS healthCheck hangs past the budget", async () => {
    vi.mocked(getKmsProvider).mockReturnValue({
      // Hang forever — simulates a TCP-reachable but stalled Vault upstream.
      healthCheck: () => new Promise(() => {}),
      describeKey: () => ({ provider: "vault-transit", keyId: "vault:k" }),
    } as never);
    const start = Date.now();
    const res = await GET();
    const elapsed = Date.now() - start;
    expect(res.status).toBe(503);
    // Bounded by the route's KMS_BUDGET_MS = 500ms (allow some slack).
    expect(elapsed).toBeLessThan(2000);
    const body = await res.json();
    expect(body.checks.kms.ok).toBe(false);
    expect(body.checks.kms.detail).toMatch(/timed?\s?out|budget/i);
  });
});
