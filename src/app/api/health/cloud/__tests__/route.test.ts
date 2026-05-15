import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn() },
}));
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

describe("/api/health/cloud", () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }] as never);
    vi.mocked(getKmsProvider).mockReturnValue({
      describeKey: () => ({ provider: "local-dev", keyId: "local-dev:abc" }),
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

  it("returns 200 + status=ok when every check passes", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.kms.ok).toBe(true);
    expect(body.checks.clock.ok).toBe(true);
  });

  it("returns 503 when database is down", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("connection refused"));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.database.detail).toMatch(/connection refused/);
  });

  it("returns 503 when KMS describeKey returns empty", async () => {
    vi.mocked(getKmsProvider).mockReturnValue({
      describeKey: () => ({ provider: "local-dev", keyId: "" }),
    } as never);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks.kms.ok).toBe(false);
  });

  it("returns 503 when clock skew exceeds threshold", async () => {
    vi.mocked(checkClockSkew).mockResolvedValue({
      ok: false,
      skewSeconds: 10,
      thresholdSeconds: 2,
      message: "clock skew 10s exceeds ±2s",
    });
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks.clock.ok).toBe(false);
    expect(body.checks.clock.detail).toMatch(/clock skew/);
  });
});
