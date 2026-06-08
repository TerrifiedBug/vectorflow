import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted prisma mock. The lakeDataset surface includes mutation methods so we
// can assert the quota path NEVER drops/rewrites data (it is a soft signal).
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lakeDataset: {
      aggregate: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  basePrisma: prismaMock,
  adminPrisma: prismaMock,
}));

vi.mock("@/lib/logger", () => ({
  errorLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
  debugLog: vi.fn(),
}));

import { warnLog } from "@/lib/logger";
import {
  checkLakeQuota,
  evaluateLakeQuota,
  setLakeQuotaProvider,
  resetLakeQuotaProvider,
  DefaultUnlimitedLakeQuotaProvider,
  type LakeQuotaProvider,
} from "../lake-quota";

/** A provider that returns a fixed ceiling for every org. */
class FixedLakeQuota implements LakeQuotaProvider {
  constructor(private readonly bytes: bigint | null) {}
  getLakeQuotaBytes(): bigint | null {
    return this.bytes;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  resetLakeQuotaProvider();
});

describe("checkLakeQuota (pure)", () => {
  it("is under quota when current < ceiling", () => {
    const r = checkLakeQuota("org-1", BigInt(50), BigInt(100));
    expect(r.overQuota).toBe(false);
    expect(r.usageRatio).toBeCloseTo(0.5);
    expect(r.quotaBytes).toBe(BigInt(100));
    expect(r.currentBytes).toBe(BigInt(50));
  });

  it("is over quota when current > ceiling", () => {
    const r = checkLakeQuota("org-1", BigInt(150), BigInt(100));
    expect(r.overQuota).toBe(true);
    expect(r.usageRatio).toBeCloseTo(1.5);
  });

  it("is NOT over quota exactly at the ceiling (strict >)", () => {
    const r = checkLakeQuota("org-1", BigInt(100), BigInt(100));
    expect(r.overQuota).toBe(false);
    expect(r.usageRatio).toBeCloseTo(1);
  });

  it("treats a null ceiling as unlimited (never over quota)", () => {
    const r = checkLakeQuota("org-1", BigInt("999999999999"), null);
    expect(r.overQuota).toBe(false);
    expect(r.quotaBytes).toBeNull();
    expect(r.usageRatio).toBeNull();
  });

  it("a zero ceiling is over quota once any byte is stored", () => {
    const over = checkLakeQuota("org-1", BigInt(1), BigInt(0));
    expect(over.overQuota).toBe(true);
    expect(over.usageRatio).toBe(Number.POSITIVE_INFINITY);

    const empty = checkLakeQuota("org-1", BigInt(0), BigInt(0));
    expect(empty.overQuota).toBe(false);
    expect(empty.usageRatio).toBe(0);
  });
});

describe("evaluateLakeQuota", () => {
  it("OSS default is unlimited and does not read the catalog", async () => {
    // Default provider (no override) — must short-circuit before any DB read.
    setLakeQuotaProvider(new DefaultUnlimitedLakeQuotaProvider());

    const r = await evaluateLakeQuota("org-1");

    expect(r.quotaBytes).toBeNull();
    expect(r.overQuota).toBe(false);
    expect(prismaMock.lakeDataset.aggregate).not.toHaveBeenCalled();
  });

  it("sums the catalog and reports under quota without signalling", async () => {
    setLakeQuotaProvider(new FixedLakeQuota(BigInt(1000)));
    prismaMock.lakeDataset.aggregate.mockResolvedValue({ _sum: { byteCount: BigInt(500) } });

    const r = await evaluateLakeQuota("org-1");

    expect(prismaMock.lakeDataset.aggregate).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      _sum: { byteCount: true },
    });
    expect(r.currentBytes).toBe(BigInt(500));
    expect(r.overQuota).toBe(false);
    expect(vi.mocked(warnLog)).not.toHaveBeenCalled();
  });

  it("fires a soft signal when over quota but NEVER drops or rewrites data", async () => {
    setLakeQuotaProvider(new FixedLakeQuota(BigInt(100)));
    prismaMock.lakeDataset.aggregate.mockResolvedValue({ _sum: { byteCount: BigInt(250) } });

    const r = await evaluateLakeQuota("org-1");

    expect(r.overQuota).toBe(true);
    expect(r.currentBytes).toBe(BigInt(250));
    // Signal fired …
    expect(vi.mocked(warnLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(warnLog).mock.calls[0][0]).toBe("lake-quota");
    // … and absolutely no data mutation (soft enforcement: read-only).
    expect(prismaMock.lakeDataset.update).not.toHaveBeenCalled();
    expect(prismaMock.lakeDataset.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.lakeDataset.delete).not.toHaveBeenCalled();
    expect(prismaMock.lakeDataset.deleteMany).not.toHaveBeenCalled();
  });

  it("treats an empty catalog (null sum) as zero bytes", async () => {
    setLakeQuotaProvider(new FixedLakeQuota(BigInt(100)));
    prismaMock.lakeDataset.aggregate.mockResolvedValue({ _sum: { byteCount: null } });

    const r = await evaluateLakeQuota("org-1");

    expect(r.currentBytes).toBe(BigInt(0));
    expect(r.overQuota).toBe(false);
    expect(vi.mocked(warnLog)).not.toHaveBeenCalled();
  });
});
