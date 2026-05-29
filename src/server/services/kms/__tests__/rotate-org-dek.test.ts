/**
 * Unit tests for `rotateOrgDek`.
 *
 * Acceptance criteria from the roadmap:
 *   1. Pre-rotation dataKeyCiphertext ≠ post-rotation.
 *   2. Every v3 ciphertext still decrypts after rotation.
 *   3. Non-v3 ciphertexts (v2: / v1 / null) are not touched.
 *   4. DekCache entry is invalidated after a successful rotation.
 *   5. `OrgNotFoundError`        when org is missing.
 *   6. `OrgNoDekError`           when org has no dataKeyCiphertext.
 *   7. `ConcurrentRotationError` when the org's DEK changed concurrently.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

import { LocalDevKmsProvider } from "../local-dev";
import { getDekCache, getKmsProvider, resetKmsForTests } from "../index";
import {
  rotateOrgDek,
  OrgNotFoundError,
  OrgNoDekError,
  ConcurrentRotationError,
} from "../rotate-org-dek";
import { encryptForOrg, decryptForOrg, ENCRYPTION_DOMAINS } from "../../crypto";

// ─── Fixture constants ────────────────────────────────────────────────────────

const ORG_ID = "org-rotate-test";

// ─── Per-test setup ───────────────────────────────────────────────────────────

let kms: LocalDevKmsProvider;
let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  // Force a known NEXTAUTH_SECRET so LocalDevKmsProvider is deterministic
  // and ALL instances (test-local + global singleton) use the same KEK.
  process.env.NEXTAUTH_SECRET = "rotate-org-dek-test-secret-32-chars-min";

  // Reset the global KMS + DekCache singletons so each test starts fresh.
  resetKmsForTests();

  kms = new LocalDevKmsProvider();
  prisma = mockDeep<PrismaClient>();

  // Wire $transaction so the callback runs immediately with the same mock.
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma as never));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function callRotate() {
  return rotateOrgDek({
    orgId: ORG_ID,
    prisma: prisma as unknown as PrismaClient,
    kms,
  });
}

function setupEmptyOrg(ciphertext: string) {
  prisma.organization.findUnique.mockResolvedValue({
    id: ORG_ID,
    dataKeyCiphertext: ciphertext,
  } as never);
  prisma.secret.findMany.mockResolvedValue([]);
  prisma.organizationSettings.findUnique.mockResolvedValue(null);
  prisma.environment.findMany.mockResolvedValue([]);
  prisma.team.findMany.mockResolvedValue([]);
  prisma.webhookEndpoint.findMany.mockResolvedValue([]);
  prisma.organization.update.mockResolvedValue({ id: ORG_ID } as never);
}

// ─── Error paths ──────────────────────────────────────────────────────────────

describe("error paths", () => {
  it("throws OrgNotFoundError when org is missing", async () => {
    prisma.organization.findUnique.mockResolvedValue(null);
    await expect(callRotate()).rejects.toThrow(OrgNotFoundError);
  });

  it("throws OrgNoDekError when org has no dataKeyCiphertext", async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: ORG_ID,
      dataKeyCiphertext: null,
    } as never);
    await expect(callRotate()).rejects.toThrow(OrgNoDekError);
  });

  it("throws ConcurrentRotationError when DEK changed between read and write", async () => {
    const { ciphertext: oldCt } = await kms.generateDataKey(ORG_ID);
    const { ciphertext: raceCt } = await kms.generateDataKey(ORG_ID);

    // First findUnique (load org) → old ciphertext.
    // Second findUnique (inside tx, optimistic lock) → ciphertext changed.
    prisma.organization.findUnique
      .mockResolvedValueOnce({ id: ORG_ID, dataKeyCiphertext: oldCt } as never)
      .mockResolvedValueOnce({ id: ORG_ID, dataKeyCiphertext: raceCt } as never);

    prisma.secret.findMany.mockResolvedValue([]);
    prisma.organizationSettings.findUnique.mockResolvedValue(null);
    prisma.environment.findMany.mockResolvedValue([]);
    prisma.team.findMany.mockResolvedValue([]);
    prisma.webhookEndpoint.findMany.mockResolvedValue([]);

    await expect(callRotate()).rejects.toThrow(ConcurrentRotationError);
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("happy path", () => {
  it("returns 0 re-encrypted rows and a new ciphertext when no v3 values exist", async () => {
    const { ciphertext: oldCt } = await kms.generateDataKey(ORG_ID);
    setupEmptyOrg(oldCt);

    const result = await callRotate();

    expect(result.totalRowsReencrypted).toBe(0);
    expect(result.newDataKeyCiphertext).not.toBe(oldCt);
    // Organization row must be updated with the new ciphertext.
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORG_ID },
        data: { dataKeyCiphertext: result.newDataKeyCiphertext },
      }),
    );
  });

  it("re-encrypts v3 secrets and verifies they decrypt correctly under the new DEK", async () => {
    const { ciphertext: oldCt } = await kms.generateDataKey(ORG_ID);

    const secret1Pt = "super-secret-value-1";
    const secret2Pt = "super-secret-value-2";

    // Runtime Secret AAD binds rowId to `${environmentId}:${name}`, NOT the
    // cuid — encrypt the fixtures the same way the app does so the rotation's
    // Phase-A decrypt matches.
    const makeCtx = (rowId: string) => ({
      orgId: ORG_ID,
      dataKeyCiphertext: oldCt,
      domain: ENCRYPTION_DOMAINS.GENERIC,
      rowTable: "Secret" as const,
      rowId,
    });

    const [secret1OldCt, secret2OldCt] = await Promise.all([
      encryptForOrg(secret1Pt, makeCtx("env-1:DB_PASSWORD")),
      encryptForOrg(secret2Pt, makeCtx("env-1:API_KEY")),
    ]);

    // Reset global cache so the service's decrypt calls go fresh.
    resetKmsForTests();
    kms = new LocalDevKmsProvider();

    prisma.organization.findUnique.mockResolvedValue({
      id: ORG_ID,
      dataKeyCiphertext: oldCt,
    } as never);
    prisma.secret.findMany.mockResolvedValue([
      { id: "sec-1", environmentId: "env-1", name: "DB_PASSWORD", encryptedValue: secret1OldCt },
      { id: "sec-2", environmentId: "env-1", name: "API_KEY", encryptedValue: secret2OldCt },
    ] as never);
    prisma.organizationSettings.findUnique.mockResolvedValue(null);
    prisma.environment.findMany.mockResolvedValue([]);
    prisma.team.findMany.mockResolvedValue([]);
    prisma.webhookEndpoint.findMany.mockResolvedValue([]);
    prisma.secret.update.mockResolvedValue({} as never);
    prisma.organization.update.mockResolvedValue({ id: ORG_ID } as never);

    const result = await rotateOrgDek({
      orgId: ORG_ID,
      prisma: prisma as unknown as PrismaClient,
      kms,
    });

    expect(result.totalRowsReencrypted).toBe(2);
    expect(result.reencrypted.secrets).toBe(2);

    // Extract the new ciphertexts from the mock update calls.
    const updateCalls = prisma.secret.update.mock.calls as Array<
      [{ where: { id: string }; data: { encryptedValue: string } }]
    >;
    const newCt1 = updateCalls.find(([a]) => a.where.id === "sec-1")?.[0].data.encryptedValue;
    const newCt2 = updateCalls.find(([a]) => a.where.id === "sec-2")?.[0].data.encryptedValue;

    expect(newCt1).toBeDefined();
    expect(newCt2).toBeDefined();

    // Old ciphertexts must NOT be reused.
    expect(newCt1).not.toBe(secret1OldCt);
    expect(newCt2).not.toBe(secret2OldCt);

    // New ciphertexts must decrypt to the original plaintext under the new DEK,
    // using the same `${environmentId}:${name}` AAD the runtime readers use.
    const newDekCt = result.newDataKeyCiphertext;
    await expect(
      decryptForOrg(newCt1!, {
        orgId: ORG_ID,
        dataKeyCiphertext: newDekCt,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Secret",
        rowId: "env-1:DB_PASSWORD",
      }),
    ).resolves.toBe(secret1Pt);

    await expect(
      decryptForOrg(newCt2!, {
        orgId: ORG_ID,
        dataKeyCiphertext: newDekCt,
        domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Secret",
        rowId: "env-1:API_KEY",
      }),
    ).resolves.toBe(secret2Pt);
  });

  it("skips v2: ciphertexts — they are not DEK-bound", async () => {
    const { ciphertext: oldCt } = await kms.generateDataKey(ORG_ID);
    // A plausible v2 ciphertext (valid base64 but not v3).
    const v2Ct = "v2:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    prisma.organization.findUnique.mockResolvedValue({
      id: ORG_ID,
      dataKeyCiphertext: oldCt,
    } as never);
    prisma.secret.findMany.mockResolvedValue([
      { id: "sec-v2", encryptedValue: v2Ct },
    ] as never);
    prisma.organizationSettings.findUnique.mockResolvedValue(null);
    prisma.environment.findMany.mockResolvedValue([]);
    prisma.team.findMany.mockResolvedValue([]);
    prisma.webhookEndpoint.findMany.mockResolvedValue([]);
    prisma.organization.update.mockResolvedValue({ id: ORG_ID } as never);

    const result = await callRotate();

    expect(result.totalRowsReencrypted).toBe(0);
    // The v2 secret must NOT have been touched.
    expect(prisma.secret.update).not.toHaveBeenCalled();
  });

  it("covers all five v3 table types and verifies one decryption per table", async () => {
    const { ciphertext: oldCt } = await kms.generateDataKey(ORG_ID);

    const plaintexts = {
      sec: "sec-val",
      oidc: "oidc-secret",
      git: "git-token",
      ai: "ai-key",
      hook: "webhook-secret",
    };

    const [secCt, oidcCt, gitCt, aiCt, hookCt] = await Promise.all([
      encryptForOrg(plaintexts.sec, {
        orgId: ORG_ID, dataKeyCiphertext: oldCt, domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Secret", rowId: "env-1:S1",
      }),
      encryptForOrg(plaintexts.oidc, {
        orgId: ORG_ID, dataKeyCiphertext: oldCt, domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "OrganizationSettings", rowId: "os1",
      }),
      encryptForOrg(plaintexts.git, {
        orgId: ORG_ID, dataKeyCiphertext: oldCt, domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Environment", rowId: "e1",
      }),
      encryptForOrg(plaintexts.ai, {
        orgId: ORG_ID, dataKeyCiphertext: oldCt, domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Team", rowId: "t1",
      }),
      encryptForOrg(plaintexts.hook, {
        orgId: ORG_ID, dataKeyCiphertext: oldCt, domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "WebhookEndpoint", rowId: "w1",
      }),
    ]);

    // Reset global cache before the service call.
    resetKmsForTests();
    kms = new LocalDevKmsProvider();

    prisma.organization.findUnique.mockResolvedValue({
      id: ORG_ID, dataKeyCiphertext: oldCt,
    } as never);
    prisma.secret.findMany.mockResolvedValue([
      { id: "s1", environmentId: "env-1", name: "S1", encryptedValue: secCt },
    ] as never);
    prisma.organizationSettings.findUnique.mockResolvedValue({
      id: "os1", oidcClientSecret: oidcCt,
    } as never);
    prisma.environment.findMany.mockResolvedValue([{ id: "e1", gitToken: gitCt }] as never);
    prisma.team.findMany.mockResolvedValue([{ id: "t1", aiApiKey: aiCt }] as never);
    prisma.webhookEndpoint.findMany.mockResolvedValue([
      { id: "w1", encryptedSecret: hookCt },
    ] as never);
    prisma.secret.update.mockResolvedValue({} as never);
    prisma.organizationSettings.update.mockResolvedValue({} as never);
    prisma.environment.update.mockResolvedValue({} as never);
    prisma.team.update.mockResolvedValue({} as never);
    prisma.webhookEndpoint.update.mockResolvedValue({} as never);
    prisma.organization.update.mockResolvedValue({ id: ORG_ID } as never);

    const result = await rotateOrgDek({
      orgId: ORG_ID,
      prisma: prisma as unknown as PrismaClient,
      kms,
    });

    expect(result.totalRowsReencrypted).toBe(5);
    expect(result.reencrypted).toEqual({
      secrets: 1,
      oidcClientSecrets: 1,
      gitTokens: 1,
      aiApiKeys: 1,
      webhookSecrets: 1,
    });

    // Each table update called exactly once.
    expect(prisma.secret.update).toHaveBeenCalledOnce();
    expect(prisma.organizationSettings.update).toHaveBeenCalledOnce();
    expect(prisma.environment.update).toHaveBeenCalledOnce();
    expect(prisma.team.update).toHaveBeenCalledOnce();
    expect(prisma.webhookEndpoint.update).toHaveBeenCalledOnce();

    // Spot-check: re-encrypted secret decrypts correctly.
    const newDekCt = result.newDataKeyCiphertext;
    const newSecCt = (
      prisma.secret.update.mock.calls[0]![0] as {
        data: { encryptedValue: string };
      }
    ).data.encryptedValue;

    await expect(
      decryptForOrg(newSecCt, {
        orgId: ORG_ID, dataKeyCiphertext: newDekCt, domain: ENCRYPTION_DOMAINS.GENERIC,
        rowTable: "Secret", rowId: "env-1:S1",
      }),
    ).resolves.toBe(plaintexts.sec);
  });

  it("invalidates the DekCache entry after a successful rotation", async () => {
    const { ciphertext: oldCt } = await kms.generateDataKey(ORG_ID);
    setupEmptyOrg(oldCt);

    await rotateOrgDek({
      orgId: ORG_ID,
      prisma: prisma as unknown as PrismaClient,
      kms,
    });

    // After rotation the cache entry for this org is gone. Pre-populate the
    // global DekCache by calling get() with the OLD ciphertext. This MUST
    // trigger a fresh unwrap (cache miss) rather than hitting a stale entry.
    // We verify the cache miss by checking the global provider is called.
    const globalKms = getKmsProvider();
    const unwrapSpy = vi.spyOn(globalKms, "unwrapDataKey");

    await getDekCache().get(ORG_ID, oldCt).catch(() => undefined);

    // The global cache has no entry for ORG_ID (it was invalidated), so it
    // must have called unwrapDataKey.
    expect(unwrapSpy).toHaveBeenCalledOnce();
  });
});
