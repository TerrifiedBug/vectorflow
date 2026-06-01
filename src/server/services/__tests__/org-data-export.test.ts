import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { prisma } from "@/lib/prisma";
import {
  ORG_DATA_EXPORT_SCHEMA_VERSION,
  buildOrgDataExport,
  canonicalize,
  checksumCanonical,
} from "@/server/services/org-data-export";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const NOW = new Date("2026-04-15T12:00:00Z");

function setupHappyPath() {
  prismaMock.organization.findUnique.mockResolvedValue({
    id: "org-1",
    slug: "acme",
    name: "Acme",
    plan: "FREE",
    region: "eu-west-2",
    dataKeyCiphertext: "secret-ciphertext-bytes",
    dekWrapKeyId: "arn:aws:kms:eu-west-2:123:key/abc",
    byokWrapKeyId: null,
    suspendedAt: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  prismaMock.organizationSettings.findUnique.mockResolvedValue({
    id: "settings-1",
    organizationId: "org-1",
    oidcIssuer: "https://idp.example",
    oidcClientId: "client-public-id",
    oidcClientSecret: "client-secret-shhh",
    scimEnabled: true,
    scimBearerToken: "Bearer abc123",
    backupStorageBackend: "s3",
    s3Bucket: "vf-backups",
    s3AccessKeyId: "AKIAEXAMPLE",
    s3SecretAccessKey: "SUPERSECRET",
    s3Endpoint: null,
    backupEnabled: true,
    telemetryEnabled: false,
    updatedAt: NOW,
  } as never);
  prismaMock.team.findMany.mockResolvedValue([
    { id: "team-1", organizationId: "org-1", name: "Eng" } as never,
  ]);
  prismaMock.environment.findMany.mockResolvedValue([]);
  prismaMock.vectorNode.findMany.mockResolvedValue([]);
  prismaMock.pipeline.findMany.mockResolvedValue([]);
  prismaMock.pipelineVersion.findMany.mockResolvedValue([]);
  prismaMock.alertRule.findMany.mockResolvedValue([]);
  prismaMock.notificationChannel.findMany.mockResolvedValue([
    {
      id: "ch-1",
      organizationId: "org-1",
      environmentId: "env-1",
      name: "ops-slack",
      type: "slack",
      config: { url: "https://hooks.slack.com/services/SECRET" },
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    } as never,
  ]);
  prismaMock.webhookEndpoint.findMany.mockResolvedValue([
    {
      id: "wh-1",
      organizationId: "org-1",
      teamId: "team-1",
      name: "ext-hook",
      url: "https://customer.example/hooks",
      encryptedSecret: "enc:abc:def:ghi",
      eventTypes: [],
    } as never,
  ]);
  prismaMock.auditLog.findMany.mockResolvedValue([]);
  prismaMock.orgMember.findMany.mockResolvedValue([
    {
      id: "m-1",
      organizationId: "org-1",
      userId: "u-1",
      role: "OWNER",
      createdAt: NOW,
    } as never,
  ]);
  prismaMock.user.findMany.mockResolvedValue([
    {
      id: "u-1",
      email: "alice@example.com",
      name: "Alice",
      image: "https://gravatar/abc.png",
      passwordHash: "$argon2id$...",
      authMethod: "LOCAL",
      lockedAt: null,
      createdAt: NOW,
    } as never,
  ]);
  prismaMock.orgAccessGrant.findMany.mockResolvedValue([
    {
      id: "g-1",
      organizationId: "org-1",
      operatorId: "op-1",
      approvedByCustomerAdminId: null,
      reason: "support",
      externalGrantRef: "live-grant-token",
      expiresAt: NOW,
      revokedAt: null,
      createdAt: NOW,
    } as never,
  ]);
}

describe("canonicalize", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits Date as ISO string", () => {
    const d = new Date("2026-04-15T00:00:00Z");
    expect(canonicalize(d)).toBe('"2026-04-15T00:00:00.000Z"');
  });

  it("drops undefined fields, matches JSON.stringify semantics", () => {
    expect(canonicalize({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it("encodes null as the literal", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });

  it("array of undefined coerces to null per JSON.stringify behaviour", () => {
    expect(canonicalize([undefined, 1])).toBe("[null,1]");
  });

  it("is stable across key insertion order", () => {
    const a = canonicalize({ z: 1, a: 2, m: 3 });
    const b = canonicalize({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
  });
});

describe("checksumCanonical", () => {
  it("produces the same hash regardless of key order", () => {
    const h1 = checksumCanonical({ b: 1, a: 2, c: [3, 4] });
    const h2 = checksumCanonical({ a: 2, c: [3, 4], b: 1 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any value changes", () => {
    const h1 = checksumCanonical({ x: 1 });
    const h2 = checksumCanonical({ x: 2 });
    expect(h1).not.toBe(h2);
  });
});

describe("buildOrgDataExport", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    setupHappyPath();
  });

  it("builds a v1 envelope with manifest counts + content checksum", async () => {
    const env = await buildOrgDataExport("org-1", { now: NOW });

    expect(env.version).toBe(ORG_DATA_EXPORT_SCHEMA_VERSION);
    expect(env.organizationId).toBe("org-1");
    expect(env.generatedAt).toBe(NOW.toISOString());
    expect(env.exportId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(env.manifest.contentChecksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(env.manifest.rowCounts).toMatchObject({
      organization: 1,
      teams: 1,
      alertChannels: 1,
      webhookEndpoints: 1,
      orgAccessGrants: 1,
    });
  });

  it("redacts Organization KMS / DEK columns to presence flags", async () => {
    const env = await buildOrgDataExport("org-1", { now: NOW });
    const org = env.data.organization!;
    expect(org).not.toHaveProperty("dataKeyCiphertext");
    expect(org).not.toHaveProperty("dekWrapKeyId");
    expect(org).not.toHaveProperty("byokWrapKeyId");
    expect(org.__has_dataKeyCiphertext).toBe(true);
    expect(org.__has_dekWrapKeyId).toBe(true);
    expect(org.__has_byokWrapKeyId).toBe(false);
  });

  it("redacts NotificationChannel.config (channel destination secrets)", async () => {
    const env = await buildOrgDataExport("org-1", { now: NOW });
    const ch = env.data.alertChannels[0]!;
    expect(ch).not.toHaveProperty("config");
    expect(ch.__has_config).toBe(true);
    expect(ch.name).toBe("ops-slack");
    expect(ch.type).toBe("slack");
  });

  it("redacts WebhookEndpoint.encryptedSecret", async () => {
    const env = await buildOrgDataExport("org-1", { now: NOW });
    const w = env.data.webhookEndpoints[0]!;
    expect(w).not.toHaveProperty("encryptedSecret");
    expect(w.__has_encryptedSecret).toBe(true);
    expect(w.url).toBe("https://customer.example/hooks");
  });

  it("redacts OrgAccessGrant.externalGrantRef", async () => {
    const env = await buildOrgDataExport("org-1", { now: NOW });
    const g = env.data.orgAccessGrants[0]!;
    expect(g).not.toHaveProperty("externalGrantRef");
    expect(g.__has_externalGrantRef).toBe(true);
    expect(g.reason).toBe("support");
  });

  it("checksum matches a re-computation over the data block", async () => {
    const env = await buildOrgDataExport("org-1", { now: NOW });
    expect(env.manifest.contentChecksumSha256).toBe(
      checksumCanonical(env.data),
    );
  });

  it("throws when organization does not exist", async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null as never);
    await expect(
      buildOrgDataExport("org-missing", { now: NOW }),
    ).rejects.toThrow("no organization with id org-missing");
  });

  it("honours AbortSignal between table reads", async () => {
    const controller = new AbortController();
    // Abort immediately, before any prisma call is awaited.
    controller.abort();
    await expect(
      buildOrgDataExport("org-1", { signal: controller.signal, now: NOW }),
    ).rejects.toThrow("aborted");
  });

  it("filters every read by organizationId", async () => {
    await buildOrgDataExport("org-1", { now: NOW });
    const findManyCalls = [
      prismaMock.team.findMany,
      prismaMock.environment.findMany,
      prismaMock.vectorNode.findMany,
      prismaMock.pipeline.findMany,
      prismaMock.pipelineVersion.findMany,
      prismaMock.alertRule.findMany,
      prismaMock.notificationChannel.findMany,
      prismaMock.webhookEndpoint.findMany,
      prismaMock.auditLog.findMany,
      prismaMock.orgMember.findMany,
      prismaMock.orgAccessGrant.findMany,
    ];
    for (const m of findManyCalls) {
      const arg = m.mock.calls[0]?.[0];
      expect(arg?.where).toEqual(
        expect.objectContaining({ organizationId: "org-1" }),
      );
    }
  });

  it("includes tenantUsers for everyone in orgMembers (whitelist select)", async () => {
    // The select clause means prisma never returns sensitive fields, so
    // the mock should mirror what the production query asks for.
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: "u-1",
        email: "alice@example.com",
        name: "Alice",
        authMethod: "LOCAL",
        lockedAt: null,
        totpEnabled: false,
        createdAt: NOW,
      } as never,
    ]);

    const env = await buildOrgDataExport("org-1", { now: NOW });
    expect(env.data.tenantUsers).toHaveLength(1);
    const u = env.data.tenantUsers[0]!;
    expect(u.id).toBe("u-1");
    expect(u.email).toBe("alice@example.com");
    expect(u.name).toBe("Alice");
    expect(u).not.toHaveProperty("passwordHash");
    expect(u).not.toHaveProperty("image");
    expect(u).not.toHaveProperty("totpSecret");
    expect(u).not.toHaveProperty("totpBackupCodes");
    expect(u).not.toHaveProperty("isSuperAdmin");
    expect(u).not.toHaveProperty("mustChangePassword");
    expect(u).not.toHaveProperty("scimExternalId");

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["u-1"] } },
        select: expect.objectContaining({
          id: true,
          email: true,
          name: true,
          authMethod: true,
          lockedAt: true,
          totpEnabled: true,
          createdAt: true,
        }),
      }),
    );
  });

  it("skips the tenantUsers query when orgMembers is empty", async () => {
    prismaMock.orgMember.findMany.mockResolvedValue([] as never);
    prismaMock.user.findMany.mockClear();
    const env = await buildOrgDataExport("org-1", { now: NOW });
    expect(env.data.tenantUsers).toEqual([]);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it("emits empty manifest.truncated when no read hit the cap", async () => {
    const env = await buildOrgDataExport("org-1", { now: NOW });
    expect(env.manifest.truncated).toEqual([]);
  });

  it("flags any table that returned >= perTableLimit rows in manifest.truncated", async () => {
    // perTableLimit = 1; alertChannels mock returns 1 \u2192 hit cap.
    const env = await buildOrgDataExport("org-1", {
      now: NOW,
      perTableLimit: 1,
    });
    const scopes = env.manifest.truncated.map((t) => t.scope);
    expect(scopes).toContain("alertChannels");
    expect(scopes).toContain("webhookEndpoints");
    expect(scopes).toContain("orgAccessGrants");
    expect(scopes).toContain("orgMembers");
    expect(scopes).toContain("tenantUsers");
    for (const entry of env.manifest.truncated) {
      expect(entry.limit).toBe(1);
      expect(entry.returnedRows).toBeGreaterThanOrEqual(1);
    }
  });

  it("rejects perTableLimit <= 0", async () => {
    await expect(
      buildOrgDataExport("org-1", { now: NOW, perTableLimit: 0 }),
    ).rejects.toThrow("must be a positive finite number");
    await expect(
      buildOrgDataExport("org-1", { now: NOW, perTableLimit: -1 }),
    ).rejects.toThrow("must be a positive finite number");
  });

  it("rejects non-finite perTableLimit (Infinity / NaN)", async () => {
    await expect(
      buildOrgDataExport("org-1", { now: NOW, perTableLimit: Infinity }),
    ).rejects.toThrow("must be a positive finite number");
    await expect(
      buildOrgDataExport("org-1", { now: NOW, perTableLimit: Number.NaN }),
    ).rejects.toThrow("must be a positive finite number");
  });
});
