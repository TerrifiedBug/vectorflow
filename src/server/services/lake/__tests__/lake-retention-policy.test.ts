import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import {
  envRetentionPolicyName,
  getEnvRetention,
  setEnvRetention,
  clearEnvRetention,
  resolveEnvRetentionPolicyId,
  assertValidRetention,
  InvalidRetentionError,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
} from "@/server/services/lake/lake-retention-policy";
import {
  LAKE_DEFAULT_HOT_DAYS,
  LAKE_DEFAULT_COLD_DAYS,
} from "@/server/services/lake/lake-retention";

const db = mockDeep<PrismaClient>();
const orgId = "org-1";
const environmentId = "env-1";
const policyName = envRetentionPolicyName(environmentId);

beforeEach(() => mockReset(db));

describe("envRetentionPolicyName", () => {
  it("namespaces the policy per environment", () => {
    expect(envRetentionPolicyName("abc")).toBe("__env:abc");
  });
});

describe("assertValidRetention", () => {
  it("accepts a sane window", () => {
    expect(() => assertValidRetention(7, 90)).not.toThrow();
    expect(() => assertValidRetention(30, 30)).not.toThrow();
  });

  it("rejects cold earlier than hot", () => {
    expect(() => assertValidRetention(30, 7)).toThrow(InvalidRetentionError);
  });

  it("rejects out-of-bounds and non-integer values", () => {
    expect(() => assertValidRetention(MIN_RETENTION_DAYS - 1, 90)).toThrow(InvalidRetentionError);
    expect(() => assertValidRetention(7, MAX_RETENTION_DAYS + 1)).toThrow(InvalidRetentionError);
    expect(() => assertValidRetention(7.5, 90)).toThrow(InvalidRetentionError);
  });
});

describe("getEnvRetention", () => {
  it("returns the table defaults when no policy exists", async () => {
    db.lakeRetentionPolicy.findUnique.mockResolvedValue(null);
    const r = await getEnvRetention(db, { orgId, environmentId });
    expect(r).toEqual({
      hotDays: LAKE_DEFAULT_HOT_DAYS,
      coldDays: LAKE_DEFAULT_COLD_DAYS,
      isDefault: true,
    });
  });

  it("returns the policy window when one exists", async () => {
    db.lakeRetentionPolicy.findUnique.mockResolvedValue({
      hotDays: 14,
      coldDays: 45,
    } as never);
    const r = await getEnvRetention(db, { orgId, environmentId });
    expect(r).toEqual({ hotDays: 14, coldDays: 45, isDefault: false });
    expect(db.lakeRetentionPolicy.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_name: { organizationId: orgId, name: policyName } },
      }),
    );
  });
});

describe("setEnvRetention", () => {
  it("upserts the per-env policy and attaches every env dataset", async () => {
    db.lakeRetentionPolicy.upsert.mockResolvedValue({ id: "pol-1" } as never);
    db.lakeDataset.updateMany.mockResolvedValue({ count: 3 } as never);

    const res = await setEnvRetention(db, { orgId, environmentId, hotDays: 5, coldDays: 30 });

    expect(res).toEqual({ policyId: "pol-1", attached: 3 });
    expect(db.lakeRetentionPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organizationId: orgId,
          name: policyName,
          hotDays: 5,
          coldDays: 30,
        }),
        update: { hotDays: 5, coldDays: 30 },
      }),
    );
    expect(db.lakeDataset.updateMany).toHaveBeenCalledWith({
      where: { organizationId: orgId, environmentId },
      data: { retentionPolicyId: "pol-1" },
    });
  });

  it("rejects an invalid window before touching the DB", async () => {
    await expect(
      setEnvRetention(db, { orgId, environmentId, hotDays: 90, coldDays: 7 }),
    ).rejects.toBeInstanceOf(InvalidRetentionError);
    expect(db.lakeRetentionPolicy.upsert).not.toHaveBeenCalled();
  });
});

describe("clearEnvRetention", () => {
  it("detaches datasets and deletes the policy", async () => {
    db.lakeRetentionPolicy.findUnique.mockResolvedValue({ id: "pol-1" } as never);
    db.lakeDataset.updateMany.mockResolvedValue({ count: 2 } as never);

    const res = await clearEnvRetention(db, { orgId, environmentId });

    expect(res).toEqual({ cleared: true, detached: 2 });
    expect(db.lakeDataset.updateMany).toHaveBeenCalledWith({
      where: { organizationId: orgId, retentionPolicyId: "pol-1" },
      data: { retentionPolicyId: null },
    });
    expect(db.lakeRetentionPolicy.delete).toHaveBeenCalledWith({ where: { id: "pol-1" } });
  });

  it("is a no-op when no policy exists", async () => {
    db.lakeRetentionPolicy.findUnique.mockResolvedValue(null);
    const res = await clearEnvRetention(db, { orgId, environmentId });
    expect(res).toEqual({ cleared: false, detached: 0 });
    expect(db.lakeRetentionPolicy.delete).not.toHaveBeenCalled();
  });
});

describe("resolveEnvRetentionPolicyId", () => {
  it("returns the policy id when set, null otherwise", async () => {
    db.lakeRetentionPolicy.findUnique.mockResolvedValueOnce({ id: "pol-1" } as never);
    expect(await resolveEnvRetentionPolicyId(db, { orgId, environmentId })).toBe("pol-1");

    db.lakeRetentionPolicy.findUnique.mockResolvedValueOnce(null);
    expect(await resolveEnvRetentionPolicyId(db, { orgId, environmentId })).toBeNull();
  });
});
