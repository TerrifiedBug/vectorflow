import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  organizationUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  $transaction: vi.fn(),
  dekCacheGet: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.$transaction,
    organization: {
      findUnique: mocks.organizationFindUnique,
      update: mocks.organizationUpdate,
    },
    auditLog: { create: mocks.auditLogCreate },
  },
}));
vi.mock("@/server/services/kms", () => ({
  getDekCache: () => ({ get: mocks.dekCacheGet }),
}));
vi.mock("@/server/services/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/logger", () => ({
  infoLog: vi.fn(),
  warnLog: vi.fn(),
  errorLog: vi.fn(),
}));

import {
  getJwtSecretForOrg,
  revokeOrgSessions,
} from "../jwt-key";
import { deriveJwtSigningKey } from "@/server/services/crypto";

function makeTxStub() {
  return {
    organization: {
      findUnique: mocks.organizationFindUnique,
      update: mocks.organizationUpdate,
    },
    auditLog: { create: mocks.auditLogCreate },
  };
}

describe("getJwtSecretForOrg", () => {
  const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    mocks.organizationFindUnique.mockReset();
    mocks.dekCacheGet.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET;
  });

  it("derives a per-org secret from the DEK when dataKeyCiphertext is set", async () => {
    const dek = Buffer.alloc(32, 0x42);
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      dataKeyCiphertext: "ct-a",
      jwtKeyRotationCounter: 3,
    });
    mocks.dekCacheGet.mockResolvedValue(dek);

    const secret = await getJwtSecretForOrg("org-a");
    expect(secret).toEqual(deriveJwtSigningKey(dek, 3));
  });

  it("counter change yields a different derived secret (rotation works)", async () => {
    const dek = Buffer.alloc(32, 0x42);
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      dataKeyCiphertext: "ct-a",
      jwtKeyRotationCounter: 0,
    });
    mocks.dekCacheGet.mockResolvedValue(dek);
    const before = await getJwtSecretForOrg("org-a");

    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      dataKeyCiphertext: "ct-a",
      jwtKeyRotationCounter: 1,
    });
    const after = await getJwtSecretForOrg("org-a");

    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  it("falls back to NEXTAUTH_SECRET when the org has no DEK", async () => {
    process.env.NEXTAUTH_SECRET = "fallback-secret";
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      dataKeyCiphertext: null,
      jwtKeyRotationCounter: 0,
    });
    const secret = await getJwtSecretForOrg("org-a");
    expect(secret.toString("utf8")).toBe("fallback-secret");
  });

  it("falls back to NEXTAUTH_SECRET when KMS unwrap throws", async () => {
    process.env.NEXTAUTH_SECRET = "fallback-secret";
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      dataKeyCiphertext: "ct-a",
      jwtKeyRotationCounter: 0,
    });
    mocks.dekCacheGet.mockRejectedValue(new Error("KMS unreachable"));
    const secret = await getJwtSecretForOrg("org-a");
    expect(secret.toString("utf8")).toBe("fallback-secret");
  });

  it("throws when neither DEK nor NEXTAUTH_SECRET is configured", async () => {
    delete process.env.NEXTAUTH_SECRET;
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      dataKeyCiphertext: null,
      jwtKeyRotationCounter: 0,
    });
    await expect(getJwtSecretForOrg("org-a")).rejects.toThrow(
      /neither per-org DEK nor NEXTAUTH_SECRET/,
    );
  });
});

describe("revokeOrgSessions", () => {
  beforeEach(() => {
    mocks.$transaction.mockReset();
    mocks.organizationFindUnique.mockReset();
    mocks.organizationUpdate.mockReset();
    mocks.auditLogCreate.mockReset();
    mocks.$transaction.mockImplementation(async (fn) => fn(makeTxStub()));
  });

  it("increments the counter by 1 and writes an audit row", async () => {
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      jwtKeyRotationCounter: 7,
    });
    mocks.organizationUpdate.mockResolvedValue({});
    mocks.auditLogCreate.mockResolvedValue({});

    const r = await revokeOrgSessions("org-a", {
      kind: "customer",
      id: "user-1",
      ipAddress: "1.2.3.4",
      reason: "lost laptop",
    });
    expect(r).toEqual({ organizationId: "org-a", newRotationCounter: 8 });
    expect(mocks.organizationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-a" },
        data: { jwtKeyRotationCounter: 8 },
      }),
    );
    expect(mocks.auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          userId: "user-1",
          action: "auth.sessions_revoked",
          entityType: "Organization",
          ipAddress: "1.2.3.4",
        }),
      }),
    );
  });

  it("operator-driven revocation does not stamp userId on AuditLog", async () => {
    mocks.organizationFindUnique.mockResolvedValue({
      id: "org-a",
      jwtKeyRotationCounter: 0,
    });
    mocks.organizationUpdate.mockResolvedValue({});
    mocks.auditLogCreate.mockResolvedValue({});

    await revokeOrgSessions("org-a", { kind: "operator", id: "op-1" });
    const auditCall = mocks.auditLogCreate.mock.calls[0]?.[0]?.data;
    expect(auditCall?.userId).toBeNull();
    expect(auditCall?.metadata?.requestedBy).toBe("operator");
  });

  it("throws when the org does not exist", async () => {
    mocks.organizationFindUnique.mockResolvedValue(null);
    await expect(
      revokeOrgSessions("org-x", { kind: "customer", id: "u" }),
    ).rejects.toThrow(/not found/);
  });
});

describe("deriveJwtSigningKey rotation behaviour", () => {
  it("returns byte-identical keys for the same (dek, counter)", () => {
    const dek = Buffer.alloc(32, 0x11);
    expect(deriveJwtSigningKey(dek, 0)).toEqual(deriveJwtSigningKey(dek, 0));
    expect(deriveJwtSigningKey(dek, 99)).toEqual(deriveJwtSigningKey(dek, 99));
  });

  it("counter=0 with the no-arg form is byte-identical (back-compat)", () => {
    const dek = Buffer.alloc(32, 0x11);
    expect(deriveJwtSigningKey(dek, 0)).toEqual(deriveJwtSigningKey(dek));
  });

  it("different counters yield different keys", () => {
    const dek = Buffer.alloc(32, 0x11);
    const a = deriveJwtSigningKey(dek, 0);
    const b = deriveJwtSigningKey(dek, 1);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it("rejects negative or non-integer counters", () => {
    const dek = Buffer.alloc(32, 0x11);
    expect(() => deriveJwtSigningKey(dek, -1)).toThrow();
    expect(() => deriveJwtSigningKey(dek, 1.5)).toThrow();
  });
});
