import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requirePlatformOperator: passthrough,
    requireOrgAdmin: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/crypto", () => ({
  ENCRYPTION_DOMAINS: { GENERIC: "generic" } as const,
  encrypt: vi.fn((val: string) => `enc:${val}`),
  decrypt: vi.fn((val: string) => val.replace("enc:", "")),
  encryptForOrg: vi.fn(async (val: string) => `v3:${val}`),
  decryptForOrg: vi.fn(async (val: string) => val.replace(/^v3:/, "")),
}));

vi.mock("@/server/services/backup", () => ({
  createBackup: vi.fn().mockResolvedValue({ filename: "backup-1.tar.gz", size: 1024, createdAt: new Date().toISOString() }),
  listBackups: vi.fn().mockResolvedValue([]),
  deleteBackup: vi.fn().mockResolvedValue(undefined),
  restoreFromBackup: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
  runRetentionCleanup: vi.fn().mockResolvedValue(undefined),
  previewBackup: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/server/services/version-check", () => ({
  checkServerVersion: vi.fn().mockResolvedValue({ current: "1.0.0", latest: "1.0.0" }),
  checkAgentVersion: vi.fn().mockResolvedValue({ current: "1.0.0", latest: "1.0.0" }),
  checkDevAgentVersion: vi.fn().mockResolvedValue({ latestVersion: "1.0.0", checksums: {}, checkedAt: new Date().toISOString() }),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send = vi.fn().mockResolvedValue({});
  }
  return {
    S3Client: MockS3Client,
    HeadBucketCommand: vi.fn(),
    PutObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
  };
});

vi.mock("@/server/services/backup-scheduler", () => ({
  rescheduleBackupForOrg: vi.fn(),
  isValidCron: vi.fn().mockReturnValue(true),
}));

vi.mock("@/server/services/url-validation", () => ({
  validatePublicUrl: vi.fn().mockResolvedValue(undefined),
  validateOutboundUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/auth", () => ({
  invalidateAuthCache: vi.fn(),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { settingsRouter } from "@/server/routers/settings";
import { createBackup, restoreFromBackup } from "@/server/services/backup";
import { isValidCron, rescheduleBackupForOrg } from "@/server/services/backup-scheduler";
import { encrypt } from "@/server/services/crypto";
import { invalidateAuthCache } from "@/auth";
import { mockOrgSettings } from "@/__tests__/helpers/mock-org-settings";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const caller = t.createCallerFactory(settingsRouter)({
  session: { user: { id: "user-1", email: "admin@test.com", name: "Admin" } },
  userRole: "ADMIN",
  organizationId: "default",
  teamId: "team-1",
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockSettings(overrides: Record<string, unknown> = {}) {
  const defaults = {
    id: "singleton",
    oidcIssuer: null,
    oidcClientId: null,
    oidcClientSecret: null,
    oidcDisplayName: null,
    oidcDefaultRole: "VIEWER",
    oidcGroupSyncEnabled: false,
    oidcGroupsScope: null,
    oidcGroupsClaim: "groups",
    oidcAdminGroups: null,
    oidcEditorGroups: null,
    oidcTokenEndpointAuthMethod: "client_secret_post",
    oidcTeamMappings: null,
    oidcDefaultTeamId: null,
    fleetPollIntervalMs: 10000,
    fleetUnhealthyThreshold: 3,
    metricsRetentionDays: 30,
    logsRetentionDays: 7,
    backupEnabled: false,
    backupCron: "0 2 * * *",
    backupRetentionCount: 5,
    lastBackupAt: null,
    lastBackupStatus: null,
    lastBackupError: null,
    backupStorageBackend: "local",
    s3Bucket: null,
    s3Region: null,
    s3Prefix: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Endpoint: null,
    scimEnabled: false,
    scimBearerToken: null,
    anomalyBaselineWindowDays: 7,
    anomalySigmaThreshold: 3,
    anomalyMinStddevFloorPercent: 10,
    anomalyDedupWindowHours: 4,
    anomalyEnabledMetrics: "eventsIn,errorsTotal",
    updatedAt: new Date(),
    ...overrides,
  };
  prismaMock.systemSettings.findUnique.mockResolvedValue(defaults as never);
  prismaMock.systemSettings.create.mockResolvedValue(defaults as never);
  // Also mock organizationSettings with the same overrides
  prismaMock.organizationSettings.findUnique.mockResolvedValue(mockOrgSettings(overrides) as never);
  prismaMock.organizationSettings.create.mockResolvedValue(mockOrgSettings(overrides) as never);
  prismaMock.organizationSettings.upsert.mockResolvedValue(mockOrgSettings(overrides) as never);
  return defaults;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("settingsRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    prismaMock.organizationSettings.findUnique.mockResolvedValue(mockOrgSettings());
    prismaMock.organizationSettings.create.mockResolvedValue(mockOrgSettings());
  });

  // ─── get ──────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns settings with masked secrets", async () => {
      mockSettings({
        oidcClientSecret: "enc:my-secret-value",
        oidcIssuer: "https://idp.example.com",
        oidcClientId: "client-123",
      });

      const result = await caller.get();

      expect(result.oidcIssuer).toBe("https://idp.example.com");
      expect(result.oidcClientId).toBe("client-123");
      // The decrypt mock strips "enc:" prefix, leaving "my-secret-value" (15 chars)
      // maskSecret shows "****" + last 4 chars
      expect(result.oidcClientSecret).toBe("****alue");
    });

    it("returns null for missing secrets", async () => {
      mockSettings({ oidcClientSecret: null });

      const result = await caller.get();

      expect(result.oidcClientSecret).toBeNull();
    });
  });

  // ─── updateOidc ───────────────────────────────────────────────────────────

  describe("updateOidc", () => {
    function mockVerifiedClaim(domain = "example.com") {
      prismaMock.organizationDomainClaim.findMany.mockResolvedValue([
        { id: "claim_1", domain } as never,
      ]);
    }

    it("updates OIDC settings and encrypts client secret when domain claim covers issuer", async () => {
      mockSettings();
      mockVerifiedClaim();
      const updated = { id: "singleton" };
      prismaMock.systemSettings.update.mockResolvedValue(updated as never);
      prismaMock.organizationSettings.upsert.mockResolvedValue(updated as never);

      await caller.updateOidc({
        issuer: "https://idp.example.com",
        clientId: "client-123",
        clientSecret: "super-secret",
        displayName: "My SSO",
        tokenEndpointAuthMethod: "client_secret_post",
      });

      expect(encrypt).toHaveBeenCalledWith("super-secret", "generic");
      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "default" },
          update: expect.objectContaining({
            oidcIssuer: "https://idp.example.com",
            oidcClientId: "client-123",
            oidcClientSecret: "enc:super-secret",
          }),
        }),
      );
      expect(invalidateAuthCache).toHaveBeenCalled();
    });

    it("skips encrypting when clientSecret is 'unchanged'", async () => {
      mockSettings();
      mockVerifiedClaim();
      prismaMock.systemSettings.update.mockResolvedValue({} as never);
      prismaMock.organizationSettings.upsert.mockResolvedValue({} as never);

      await caller.updateOidc({
        issuer: "https://idp.example.com",
        clientId: "client-123",
        clientSecret: "unchanged",
        displayName: "SSO",
      });

      expect(encrypt).not.toHaveBeenCalled();
    });

    it("refuses when the org has no verified domain claim", async () => {
      mockSettings();
      prismaMock.organizationDomainClaim.findMany.mockResolvedValue([]);

      await expect(
        caller.updateOidc({
          issuer: "https://idp.example.com",
          clientId: "client-123",
          clientSecret: "super-secret",
          displayName: "SSO",
          tokenEndpointAuthMethod: "client_secret_post",
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringMatching(/verified domain claim/i),
      });

      // Persistence path NEVER touched.
      expect(prismaMock.organizationSettings.upsert).not.toHaveBeenCalled();
      expect(invalidateAuthCache).not.toHaveBeenCalled();
    });

    it("accepts when issuer is on a subdomain of a verified claim", async () => {
      mockSettings();
      mockVerifiedClaim("acme.com");
      prismaMock.organizationSettings.upsert.mockResolvedValue({} as never);

      await caller.updateOidc({
        issuer: "https://login.acme.com/oauth2",
        clientId: "client-123",
        clientSecret: "super-secret",
        displayName: "Acme SSO",
        tokenEndpointAuthMethod: "client_secret_post",
      });

      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalled();
    });

    it("refuses when issuer hostname does not match any verified claim", async () => {
      mockSettings();
      mockVerifiedClaim("acme.com");

      await expect(
        caller.updateOidc({
          issuer: "https://login.evilacme.com/oauth2",
          clientId: "client-123",
          clientSecret: "super-secret",
          displayName: "SSO",
          tokenEndpointAuthMethod: "client_secret_post",
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringMatching(/not covered/i),
      });
    });

    it("refuses when the only claim is unverified (filter excludes it)", async () => {
      mockSettings();
      // `findMany` with `verifiedAt: { not: null }` returns nothing
      // when the only existing claim is unverified.
      prismaMock.organizationDomainClaim.findMany.mockResolvedValue([]);

      await expect(
        caller.updateOidc({
          issuer: "https://idp.example.com",
          clientId: "client-123",
          clientSecret: "super-secret",
          displayName: "SSO",
          tokenEndpointAuthMethod: "client_secret_post",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("PR #377: accepts a shared-IdP issuer when allowSharedIdpHostnames=true", async () => {
      // Org settings have the operator-bypass flag flipped on. No verified
      // claim exists for `accounts.google.com` (no tenant can claim it).
      mockSettings({ allowSharedIdpHostnames: true });
      prismaMock.organizationDomainClaim.findMany.mockResolvedValue([]);

      await caller.updateOidc({
        issuer: "https://accounts.google.com/o/oauth2",
        clientId: "client-google",
        clientSecret: "super-secret",
        displayName: "Google SSO",
        tokenEndpointAuthMethod: "client_secret_post",
      });

      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "default" },
          update: expect.objectContaining({
            oidcIssuer: "https://accounts.google.com/o/oauth2",
          }),
        }),
      );
      expect(invalidateAuthCache).toHaveBeenCalled();
    });

    it("PR #377: refuses the same shared-IdP issuer when allowSharedIdpHostnames=false (default)", async () => {
      mockSettings({ allowSharedIdpHostnames: false });
      prismaMock.organizationDomainClaim.findMany.mockResolvedValue([]);

      await expect(
        caller.updateOidc({
          issuer: "https://accounts.google.com/o/oauth2",
          clientId: "client-google",
          clientSecret: "super-secret",
          displayName: "Google SSO",
          tokenEndpointAuthMethod: "client_secret_post",
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringMatching(/verified domain claim/i),
      });
      expect(prismaMock.organizationSettings.upsert).not.toHaveBeenCalled();
    });

    it("PR #377: still encrypts oidcClientSecret on the bypass path (no field-side regression)", async () => {
      mockSettings({ allowSharedIdpHostnames: true });
      prismaMock.organizationDomainClaim.findMany.mockResolvedValue([]);

      await caller.updateOidc({
        issuer: "https://accounts.google.com/o/oauth2",
        clientId: "client-google",
        clientSecret: "fresh-secret",
        displayName: "Google SSO",
        tokenEndpointAuthMethod: "client_secret_post",
      });

      expect(encrypt).toHaveBeenCalledWith("fresh-secret", "generic");
      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            oidcClientSecret: "enc:fresh-secret",
          }),
        }),
      );
    });

    // ─── PR 9-A: v3 envelope routing ────────────────────────────────────────

    it("PR 9-A: encrypts oidcClientSecret via v3 when the org has a dataKeyCiphertext", async () => {
      mockSettings();
      mockVerifiedClaim();
      prismaMock.organization.findUnique.mockResolvedValue({
        dataKeyCiphertext: "wrapped-dek",
      } as never);

      await caller.updateOidc({
        issuer: "https://idp.example.com",
        clientId: "client-123",
        clientSecret: "super-secret",
        displayName: "SSO",
        tokenEndpointAuthMethod: "client_secret_post",
      });

      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            oidcClientSecret: "v3:super-secret",
          }),
        }),
      );
    });

    it("PR 9-A: stays on v2 when the org has no dataKeyCiphertext (OSS fallback)", async () => {
      mockSettings();
      mockVerifiedClaim();
      prismaMock.organization.findUnique.mockResolvedValue({
        dataKeyCiphertext: null,
      } as never);

      await caller.updateOidc({
        issuer: "https://idp.example.com",
        clientId: "client-123",
        clientSecret: "super-secret",
        displayName: "SSO",
        tokenEndpointAuthMethod: "client_secret_post",
      });

      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            oidcClientSecret: "enc:super-secret",
          }),
        }),
      );
    });

    it("PR 9-A: decrypts a v3 ciphertext on the read path", async () => {
      mockSettings({ oidcClientSecret: "v3:my-secret-value" });
      prismaMock.organization.findUnique.mockResolvedValue({
        dataKeyCiphertext: "wrapped-dek",
      } as never);

      const result = await caller.get();

      expect(result.oidcClientSecret).toBe("****alue");
    });

    it("PR 9-A: decrypts a v2 ciphertext on the read path (backwards compat)", async () => {
      mockSettings({ oidcClientSecret: "enc:my-secret-value" });
      prismaMock.organization.findUnique.mockResolvedValue({
        dataKeyCiphertext: null,
      } as never);

      const result = await caller.get();

      expect(result.oidcClientSecret).toBe("****alue");
    });
  });

  // ─── testOidc ─────────────────────────────────────────────────────────────

  describe("testOidc", () => {
    it("returns success for valid discovery endpoint", async () => {
      const discoveryResponse = {
        issuer: "https://idp.example.com",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(discoveryResponse),
      }));

      const result = await caller.testOidc({ issuer: "https://idp.example.com" });

      expect(result.success).toBe(true);
      expect(result.issuer).toBe("https://idp.example.com");

      vi.unstubAllGlobals();
    });

    it("throws BAD_REQUEST for non-OK response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }));

      await expect(
        caller.testOidc({ issuer: "https://bad.example.com" }),
      ).rejects.toThrow("OIDC discovery endpoint returned 404");

      vi.unstubAllGlobals();
    });

    it("throws BAD_REQUEST when discovery response is missing required fields", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ issuer: "https://idp.example.com" }),
      }));

      await expect(
        caller.testOidc({ issuer: "https://idp.example.com" }),
      ).rejects.toThrow("missing required fields");

      vi.unstubAllGlobals();
    });
  });

  // ─── createBackup ─────────────────────────────────────────────────────────

  describe("createBackup", () => {
    it("creates backup and runs retention cleanup", async () => {
      const result = await caller.createBackup();

      expect(createBackup).toHaveBeenCalled();
      expect(result).toMatchObject({ filename: "backup-1.tar.gz" });
    });
  });

  // ─── restoreBackup ────────────────────────────────────────────────────────

  describe("restoreBackup", () => {
    it("restores from backup file", async () => {
      const result = await caller.restoreBackup({ filename: "backup-1.tar.gz" });

      expect(restoreFromBackup).toHaveBeenCalledWith("backup-1.tar.gz");
      expect(result).toEqual({ success: true, warnings: [] });
    });
  });

  // ─── testS3Connection ─────────────────────────────────────────────────────

  describe("testS3Connection", () => {
    it("returns success when S3 connection works", async () => {
      const result = await caller.testS3Connection({
        bucket: "my-bucket",
        region: "us-east-1",
        accessKeyId: "AKIA123",
        secretAccessKey: "secret",
      });

      expect(result).toEqual({ success: true });
    });
  });

  // ─── updateBackupSchedule ─────────────────────────────────────────────────

  describe("updateBackupSchedule", () => {
    it("updates schedule with valid cron", async () => {
      mockSettings();
      prismaMock.systemSettings.update.mockResolvedValue({} as never);
      prismaMock.organizationSettings.upsert.mockResolvedValue({} as never);

      await caller.updateBackupSchedule({
        enabled: true,
        cron: "0 3 * * *",
        retentionCount: 10,
      });

      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "default" },
          update: expect.objectContaining({
            backupEnabled: true,
            backupCron: "0 3 * * *",
            backupRetentionCount: 10,
          }),
        }),
      );
      expect(rescheduleBackupForOrg).toHaveBeenCalledWith("default", true, "0 3 * * *");
    });

    it("throws BAD_REQUEST for invalid cron expression", async () => {
      vi.mocked(isValidCron).mockReturnValueOnce(false);

      await expect(
        caller.updateBackupSchedule({ enabled: true, cron: "not-valid", retentionCount: 5 }),
      ).rejects.toThrow("Invalid cron expression");
    });
  });

  // ─── updateScim ───────────────────────────────────────────────────────────

  describe("updateScim", () => {
    it("enables SCIM provisioning", async () => {
      mockSettings();
      prismaMock.systemSettings.update.mockResolvedValue({} as never);
      prismaMock.organizationSettings.upsert.mockResolvedValue({} as never);

      await caller.updateScim({ enabled: true });

      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "default" },
          update: expect.objectContaining({        }),

        }),
      );
    });

    it("clears bearer token when disabling SCIM", async () => {
      mockSettings();
      prismaMock.systemSettings.update.mockResolvedValue({} as never);
      prismaMock.organizationSettings.upsert.mockResolvedValue({} as never);

      await caller.updateScim({ enabled: false });

      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "default" },
          update: expect.objectContaining({            scimEnabled: false,
            scimBearerToken: null,
          }),
        }),

      );
    });
  });

  // ─── productionReadiness ─────────────────────────────────────────────────

  describe("productionReadiness", () => {
    type ReadinessSignal = { id: string; status: string; label: string; detail: string; href?: string };

    function setupReadinessMocks(overrides: Record<string, unknown> = {}) {
      mockSettings(overrides);
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.vectorNode.groupBy.mockResolvedValue([]);
      prismaMock.alertRule.count.mockResolvedValue(0);
      prismaMock.pipeline.findFirst.mockResolvedValue(null);
      prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }] as never);
    }

    it("returns signals and checkedAt when database is healthy", async () => {
      setupReadinessMocks({
        backupEnabled: true,
        lastBackupAt: new Date(),
        lastBackupStatus: "success",
        oidcIssuer: "https://sso.example.com",
        scimEnabled: true,
      });
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.vectorNode.groupBy.mockResolvedValue([
        { status: "HEALTHY", _count: { id: 3 } },
      ]);
      prismaMock.alertRule.count.mockResolvedValue(3);
      prismaMock.pipeline.findFirst.mockResolvedValue({
        isDraft: false,
        deployedAt: new Date(),
      } as never);

      const result = await caller.productionReadiness();

      expect(result.signals).toHaveLength(8);
      expect(result.checkedAt).toBeDefined();
      const signals = result.signals as ReadinessSignal[];
      const dbSignal = signals.find((s) => s.id === "database");
      expect(dbSignal?.status).toBe("ok");
      const backupSignal = signals.find((s) => s.id === "backup");
      expect(backupSignal?.status).toBe("ok");
      const fleetSignal = signals.find((s) => s.id === "fleet");
      expect(fleetSignal?.status).toBe("ok");
      const alertSignal = signals.find((s) => s.id === "alerts");
      expect(alertSignal?.status).toBe("ok");
      expect(alertSignal?.detail).toBe("3 alert rules configured");
      expect(signals.map((s) => s.id)).not.toContain("webhooks");
      expect(signals.map((s) => s.id)).not.toContain("sentry");
    });

    it("sets database signal to error when DB query fails", async () => {
      setupReadinessMocks();
      prismaMock.$queryRaw.mockRejectedValue(new Error("connection refused"));

      const result = await caller.productionReadiness();

      const signals = result.signals as ReadinessSignal[];
      const dbSignal = signals.find((s) => s.id === "database");
      expect(dbSignal?.status).toBe("error");
    });

    it("warns when backup is disabled", async () => {
      setupReadinessMocks({ backupEnabled: false });

      const result = await caller.productionReadiness();

      const signals = result.signals as ReadinessSignal[];
      const backupSignal = signals.find((s) => s.id === "backup");
      expect(backupSignal?.status).toBe("warn");
    });

    it("errors when last backup failed", async () => {
      setupReadinessMocks({
        backupEnabled: true,
        lastBackupAt: new Date(),
        lastBackupStatus: "failed",
        lastBackupError: "disk full",
      });

      const result = await caller.productionReadiness();

      const signals = result.signals as ReadinessSignal[];
      const backupSignal = signals.find((s) => s.id === "backup");
      expect(backupSignal?.status).toBe("error");
    });

    it("warns for unhealthy fleet nodes", async () => {
      setupReadinessMocks();
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.vectorNode.groupBy.mockResolvedValue([
        { status: "HEALTHY", _count: { id: 2 } },
        { status: "UNREACHABLE", _count: { id: 1 } },
      ]);

      const result = await caller.productionReadiness();

      const signals = result.signals as ReadinessSignal[];
      const fleetSignal = signals.find((s) => s.id === "fleet");
      expect(fleetSignal?.status).toBe("warn");
    });

    it("warns for UNKNOWN fleet nodes (not treated as healthy)", async () => {
      setupReadinessMocks();
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.vectorNode.groupBy.mockResolvedValue([
        { status: "UNKNOWN", _count: { id: 3 } },
      ]);

      const result = await caller.productionReadiness();

      const signals = result.signals as ReadinessSignal[];
      const fleetSignal = signals.find((s) => s.id === "fleet");
      expect(fleetSignal?.status).toBe("warn");
    });

    it("returns unknown version status when no release data fetched", async () => {
      const originalVfVersion = process.env.VF_VERSION;
      process.env.VF_VERSION = "1.2.3";
      try {
        setupReadinessMocks({ latestServerRelease: null });

        const result = await caller.productionReadiness();

        const signals = result.signals as ReadinessSignal[];
        const versionSignal = signals.find((s) => s.id === "version");
        expect(versionSignal?.status).toBe("unknown");
      } finally {
        if (originalVfVersion === undefined) {
          delete process.env.VF_VERSION;
        } else {
          process.env.VF_VERSION = originalVfVersion;
        }
      }
    });

    it("warns when OIDC not configured", async () => {
      setupReadinessMocks({ oidcIssuer: null });

      const result = await caller.productionReadiness();

      const signals = result.signals as ReadinessSignal[];
      const oidcSignal = signals.find((s) => s.id === "oidc");
      expect(oidcSignal?.status).toBe("warn");
    });

    it("reports audit shipping as ok when system pipeline deployed", async () => {
      setupReadinessMocks();
      prismaMock.pipeline.findFirst.mockResolvedValue({
        isDraft: false,
        deployedAt: new Date(),
      } as never);

      const result = await caller.productionReadiness();

      const signals = result.signals as ReadinessSignal[];
      const auditSignal = signals.find((s) => s.id === "audit-shipping");
      expect(auditSignal?.status).toBe("ok");
    });

    it("unknown signals count toward non-ok overall status", async () => {
      const originalVfVersion = process.env.VF_VERSION;
      process.env.VF_VERSION = "1.2.3";
      try {
        // latestServerRelease null + real VF_VERSION → version signal = "unknown"
        setupReadinessMocks({
          latestServerRelease: null,
          backupEnabled: true,
          lastBackupAt: new Date(),
          lastBackupStatus: "success",
          oidcIssuer: "https://sso.example.com",
          scimEnabled: true,
        });
        // @ts-expect-error - groupBy mock typing is complex
        prismaMock.vectorNode.groupBy.mockResolvedValue([
          { status: "HEALTHY", _count: { id: 2 } },
        ]);
        prismaMock.alertRule.count.mockResolvedValue(1);
        prismaMock.pipeline.findFirst.mockResolvedValue({
          isDraft: false,
          deployedAt: new Date(),
        } as never);

        const result = await caller.productionReadiness();

        // version is "unknown" → overall must not be "ok"
        expect(result.overallStatus).not.toBe("ok");
        const signals = result.signals as ReadinessSignal[];
        const versionSignal = signals.find((s) => s.id === "version");
        expect(versionSignal?.status).toBe("unknown");
      } finally {
        if (originalVfVersion === undefined) {
          delete process.env.VF_VERSION;
        } else {
          process.env.VF_VERSION = originalVfVersion;
        }
      }
    });

    it("DB outage returns database:error payload without throwing", async () => {
      // Make the DB ping fail AND the config queries fail
      prismaMock.$queryRaw.mockRejectedValue(new Error("connection refused"));
      prismaMock.systemSettings.findUnique.mockRejectedValue(new Error("connection refused"));
      prismaMock.systemSettings.create.mockRejectedValue(new Error("connection refused"));
      // @ts-expect-error - groupBy mock typing is complex
      prismaMock.vectorNode.groupBy.mockRejectedValue(new Error("connection refused"));
      prismaMock.alertRule.count.mockRejectedValue(new Error("connection refused"));
      prismaMock.pipeline.findFirst.mockRejectedValue(new Error("connection refused"));

      // Should not throw — must return a structured payload
      const result = await caller.productionReadiness();

      const signals = result.signals as ReadinessSignal[];
      const dbSignal = signals.find((s) => s.id === "database");
      expect(dbSignal?.status).toBe("error");
      // Config-dependent signals should all be unknown
      const configSignals = signals.filter((s) => s.id !== "database");
      expect(configSignals.every((s) => s.status === "unknown")).toBe(true);
      expect(result.overallStatus).not.toBe("ok");
    });
  });

  // ── updateAiBaseUrlOptIn ──────────────────────────────────

  describe("updateAiBaseUrlOptIn", () => {
    it("rejects when caller is not an org OWNER (ADMIN userRole alone is insufficient)", async () => {
      // adminCaller has userRole=ADMIN but NO orgMemberRole — that path
      // must NOT be allowed to flip a tenant-level toggle.
      await expect(
        caller.updateAiBaseUrlOptIn({ enabled: true }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringMatching(/OWNER/),
      });
      expect(prismaMock.organizationSettings.upsert).not.toHaveBeenCalled();
    });

    it("writes the flag via updateOrgSettings when caller is an OWNER", async () => {
      const ownerCaller = t.createCallerFactory(settingsRouter)({
        session: { user: { id: "user-1", email: "owner@test.com" } },
        userRole: "ADMIN",
        organizationId: "default",
        teamId: "team-1",
        orgMemberRole: "OWNER",
      });
      prismaMock.organizationSettings.upsert.mockResolvedValue(
        mockOrgSettings({ aiBaseUrlOptIn: true }) as never,
      );

      await ownerCaller.updateAiBaseUrlOptIn({ enabled: true });

      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "default" },
          update: expect.objectContaining({ aiBaseUrlOptIn: true }),
        }),
      );
    });
  });

  // ── updateSubprocessorNoticeEmail (sub-processor change notice subscription) ─

  describe("updateSubprocessorNoticeEmail", () => {
    it("rejects when caller is not an org OWNER (ADMIN userRole alone is insufficient)", async () => {
      await expect(
        caller.updateSubprocessorNoticeEmail({ email: "ops@acme.test" }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringMatching(/OWNER/),
      });
      expect(prismaMock.organizationSettings.upsert).not.toHaveBeenCalled();
    });

    it("rejects an obviously-invalid email", async () => {
      const ownerCaller = t.createCallerFactory(settingsRouter)({
        session: { user: { id: "user-1", email: "owner@test.com" } },
        userRole: "ADMIN",
        organizationId: "default",
        teamId: "team-1",
        orgMemberRole: "OWNER",
      });
      await expect(
        ownerCaller.updateSubprocessorNoticeEmail({ email: "not-an-email" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(prismaMock.organizationSettings.upsert).not.toHaveBeenCalled();
    });

    it("writes the address when caller is an OWNER", async () => {
      const ownerCaller = t.createCallerFactory(settingsRouter)({
        session: { user: { id: "user-1", email: "owner@test.com" } },
        userRole: "ADMIN",
        organizationId: "default",
        teamId: "team-1",
        orgMemberRole: "OWNER",
      });
      prismaMock.organizationSettings.upsert.mockResolvedValue(
        mockOrgSettings({ subprocessorNoticeEmail: "ops@acme.test" }) as never,
      );

      await ownerCaller.updateSubprocessorNoticeEmail({ email: "ops@acme.test" });

      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "default" },
          update: expect.objectContaining({
            subprocessorNoticeEmail: "ops@acme.test",
          }),
        }),
      );
    });

    it("clears the subscription when email is null", async () => {
      const ownerCaller = t.createCallerFactory(settingsRouter)({
        session: { user: { id: "user-1", email: "owner@test.com" } },
        userRole: "ADMIN",
        organizationId: "default",
        teamId: "team-1",
        orgMemberRole: "OWNER",
      });
      prismaMock.organizationSettings.upsert.mockResolvedValue(
        mockOrgSettings({ subprocessorNoticeEmail: null }) as never,
      );

      await ownerCaller.updateSubprocessorNoticeEmail({ email: null });

      expect(prismaMock.organizationSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            subprocessorNoticeEmail: null,
          }),
        }),
      );
    });
  });
});
