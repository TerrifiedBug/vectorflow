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
    requireSuperAdmin: passthrough,
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
  encrypt: vi.fn((val: string) => `enc:${val}`),
  decrypt: vi.fn((val: string) => val.replace("enc:", "")),
}));

vi.mock("@/server/services/backup", () => ({
  createBackup: vi.fn().mockResolvedValue({ filename: "backup-1.tar.gz", size: 1024, createdAt: new Date().toISOString() }),
  listBackups: vi.fn().mockResolvedValue([]),
  deleteBackup: vi.fn().mockResolvedValue(undefined),
  restoreFromBackup: vi.fn().mockResolvedValue(undefined),
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
  rescheduleBackup: vi.fn(),
  isValidCron: vi.fn().mockReturnValue(true),
}));

vi.mock("@/server/services/url-validation", () => ({
  validatePublicUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/auth", () => ({
  invalidateAuthCache: vi.fn(),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { settingsRouter } from "@/server/routers/settings";
import { createBackup, restoreFromBackup } from "@/server/services/backup";
import { isValidCron, rescheduleBackup } from "@/server/services/backup-scheduler";
import { encrypt } from "@/server/services/crypto";
import { invalidateAuthCache } from "@/auth";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const caller = t.createCallerFactory(settingsRouter)({
  session: { user: { id: "user-1", email: "admin@test.com", name: "Admin" } },
  userRole: "ADMIN",
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
  return defaults;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("settingsRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
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
    it("updates OIDC settings and encrypts client secret", async () => {
      mockSettings();
      const updated = { id: "singleton" };
      prismaMock.systemSettings.update.mockResolvedValue(updated as never);

      await caller.updateOidc({
        issuer: "https://idp.example.com",
        clientId: "client-123",
        clientSecret: "super-secret",
        displayName: "My SSO",
        tokenEndpointAuthMethod: "client_secret_post",
      });

      expect(encrypt).toHaveBeenCalledWith("super-secret");
      expect(prismaMock.systemSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
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
      prismaMock.systemSettings.update.mockResolvedValue({} as never);

      await caller.updateOidc({
        issuer: "https://idp.example.com",
        clientId: "client-123",
        clientSecret: "unchanged",
        displayName: "SSO",
      });

      expect(encrypt).not.toHaveBeenCalled();
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
      expect(result).toEqual({ success: true });
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

      await caller.updateBackupSchedule({
        enabled: true,
        cron: "0 3 * * *",
        retentionCount: 10,
      });

      expect(prismaMock.systemSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            backupEnabled: true,
            backupCron: "0 3 * * *",
            backupRetentionCount: 10,
          }),
        }),
      );
      expect(rescheduleBackup).toHaveBeenCalledWith(true, "0 3 * * *");
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

      await caller.updateScim({ enabled: true });

      expect(prismaMock.systemSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ scimEnabled: true }),
        }),
      );
    });

    it("clears bearer token when disabling SCIM", async () => {
      mockSettings();
      prismaMock.systemSettings.update.mockResolvedValue({} as never);

      await caller.updateScim({ enabled: false });

      expect(prismaMock.systemSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scimEnabled: false,
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
      prismaMock.webhookEndpoint.count.mockResolvedValue(0);
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
      prismaMock.webhookEndpoint.count.mockResolvedValue(2);
      prismaMock.pipeline.findFirst.mockResolvedValue({
        isDraft: false,
        deployedAt: new Date(),
      } as never);

      const result = await caller.productionReadiness();

      expect(result.signals).toHaveLength(9);
      expect(result.checkedAt).toBeDefined();
      const signals = result.signals as ReadinessSignal[];
      const dbSignal = signals.find((s) => s.id === "database");
      expect(dbSignal?.status).toBe("ok");
      const backupSignal = signals.find((s) => s.id === "backup");
      expect(backupSignal?.status).toBe("ok");
      const fleetSignal = signals.find((s) => s.id === "fleet");
      expect(fleetSignal?.status).toBe("ok");
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
  });
});
