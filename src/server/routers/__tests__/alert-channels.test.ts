import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t, mockValidatePublicUrl, mockValidateSmtpHost, mockChannelTest } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return {
    t,
    mockValidatePublicUrl: vi.fn().mockResolvedValue(undefined),
    mockValidateSmtpHost: vi.fn().mockResolvedValue(undefined),
    mockChannelTest: vi.fn().mockResolvedValue({ success: true }),
  };
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

vi.mock("@/server/services/url-validation", () => ({
  validatePublicUrl: mockValidatePublicUrl,
  validateSmtpHost: mockValidateSmtpHost,
}));

vi.mock("@/server/services/channels", () => ({
  getDriver: vi.fn().mockReturnValue({
    test: mockChannelTest,
    deliver: vi.fn().mockResolvedValue({ success: true }),
  }),
}));

import { prisma } from "@/lib/prisma";
import { alertChannelsRouter } from "@/server/routers/alert-channels";
import { encrypt, ENCRYPTION_DOMAINS } from "@/server/services/crypto";
import { ENCRYPTED_MARKER } from "@/server/services/channel-secrets";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(alertChannelsRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch-1",
    environmentId: "env-1",
    name: "My Slack Channel",
    type: "slack",
    config: { webhookUrl: "https://hooks.slack.com/services/test" },
    enabled: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

describe("alertChannelsRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── listChannels ──────────────────────────────────────────────────────────

  describe("listChannels", () => {
    it("returns channels with redacted sensitive fields", async () => {
      prismaMock.notificationChannel.findMany.mockResolvedValue([
        makeChannel({
          config: {
            webhookUrl: "https://hooks.slack.com/services/test",
            smtpPass: "secret-pass",
            hmacSecret: "hmac-secret",
            integrationKey: "pager-key",
          },
        }),
      ] as never);

      const result = await caller.listChannels({ environmentId: "env-1" });

      expect(result).toHaveLength(1);
      const config = result[0].config as Record<string, unknown>;
      expect(config.smtpPass).toBe("••••••••");
      expect(config.hmacSecret).toBe("••••••••");
      expect(config.integrationKey).toBe("••••••••");
      expect(config.webhookUrl).toBe("https://hooks.slack.com/services/test");
    });

    it("returns empty array when no channels exist", async () => {
      prismaMock.notificationChannel.findMany.mockResolvedValue([]);

      const result = await caller.listChannels({ environmentId: "env-1" });

      expect(result).toEqual([]);
    });

    it("decrypts non-redacted fields so the edit form receives plaintext", async () => {
      const encryptedUrl = ENCRYPTED_MARKER + encrypt(
        "https://hooks.slack.com/services/T/B/SECRETTOKEN",
        ENCRYPTION_DOMAINS.SECRETS,
      );

      prismaMock.notificationChannel.findMany.mockResolvedValue([
        makeChannel({
          type: "slack",
          config: { webhookUrl: encryptedUrl },
        }),
      ] as never);

      const result = await caller.listChannels({ environmentId: "env-1" });

      const config = result[0].config as Record<string, unknown>;
      expect(config.webhookUrl).toBe("https://hooks.slack.com/services/T/B/SECRETTOKEN");
    });

    it("decrypts encrypted webhook headers and surfaces them as an object", async () => {
      const encryptedHeaders = ENCRYPTED_MARKER + encrypt(
        JSON.stringify({ Authorization: "Bearer abc" }),
        ENCRYPTION_DOMAINS.SECRETS,
      );

      prismaMock.notificationChannel.findMany.mockResolvedValue([
        makeChannel({
          type: "webhook",
          config: { url: "https://x.test", headers: encryptedHeaders },
        }),
      ] as never);

      const result = await caller.listChannels({ environmentId: "env-1" });

      const config = result[0].config as Record<string, unknown>;
      expect(config.headers).toEqual({ Authorization: "Bearer abc" });
    });
  });

  // ─── createChannel ─────────────────────────────────────────────────────────

  describe("createChannel", () => {
    it("creates a slack channel and validates the webhook URL", async () => {
      const channelData = makeChannel();
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.notificationChannel.create.mockResolvedValue(channelData as never);

      const result = await caller.createChannel({
        environmentId: "env-1",
        name: "My Slack Channel",
        type: "slack",
        config: { webhookUrl: "https://hooks.slack.com/services/test" },
      });

      expect(result.id).toBe("ch-1");
      expect(mockValidatePublicUrl).toHaveBeenCalledWith("https://hooks.slack.com/services/test");
    });

    it("creates a webhook channel and validates the URL", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.notificationChannel.create.mockResolvedValue(makeChannel({ type: "webhook" }) as never);

      await caller.createChannel({
        environmentId: "env-1",
        name: "My Webhook",
        type: "webhook",
        config: { url: "https://example.com/hook" },
      });

      expect(mockValidatePublicUrl).toHaveBeenCalledWith("https://example.com/hook");
    });

    it("creates an email channel and validates the SMTP host", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.notificationChannel.create.mockResolvedValue(makeChannel({ type: "email" }) as never);

      await caller.createChannel({
        environmentId: "env-1",
        name: "Email Alert",
        type: "email",
        config: { smtpHost: "smtp.example.com", from: "alerts@example.com", recipients: ["user@example.com"] },
      });

      expect(mockValidateSmtpHost).toHaveBeenCalledWith("smtp.example.com");
    });

    it("creates a pagerduty channel", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.notificationChannel.create.mockResolvedValue(makeChannel({ type: "pagerduty" }) as never);

      await caller.createChannel({
        environmentId: "env-1",
        name: "PagerDuty",
        type: "pagerduty",
        config: { integrationKey: "pdkey123" },
      });

      expect(prismaMock.notificationChannel.create).toHaveBeenCalled();
    });

    it("throws NOT_FOUND if environment does not exist", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(null);

      await expect(
        caller.createChannel({
          environmentId: "env-missing",
          name: "Test",
          type: "slack",
          config: { webhookUrl: "https://hooks.slack.com/test" },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws BAD_REQUEST if slack channel missing webhookUrl", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);

      await expect(
        caller.createChannel({
          environmentId: "env-1",
          name: "Bad Slack",
          type: "slack",
          config: {},
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws BAD_REQUEST if webhook channel missing url", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);

      await expect(
        caller.createChannel({
          environmentId: "env-1",
          name: "Bad Webhook",
          type: "webhook",
          config: {},
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws BAD_REQUEST if email channel missing required fields", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);

      await expect(
        caller.createChannel({
          environmentId: "env-1",
          name: "Bad Email",
          type: "email",
          config: { smtpHost: "smtp.test.com" },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws BAD_REQUEST if pagerduty channel missing integrationKey", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);

      await expect(
        caller.createChannel({
          environmentId: "env-1",
          name: "Bad PD",
          type: "pagerduty",
          config: {},
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("encrypts hmacSecret before persisting webhook channel", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.notificationChannel.create.mockResolvedValue(
        makeChannel({ type: "webhook" }) as never,
      );

      await caller.createChannel({
        environmentId: "env-1",
        name: "Webhook With Secret",
        type: "webhook",
        config: { url: "https://example.com/hook", hmacSecret: "raw-secret" },
      });

      const createCall = prismaMock.notificationChannel.create.mock.calls[0][0];
      const persisted = (createCall as { data: { config: Record<string, unknown> } }).data.config;
      expect(persisted.hmacSecret).toMatch(/^vfenc1:/);
      expect(persisted.url).toBe("https://example.com/hook");
    });
  });

  // ─── updateChannel ─────────────────────────────────────────────────────────

  describe("updateChannel", () => {
    it("updates a channel name", async () => {
      const existing = makeChannel();
      prismaMock.notificationChannel.findUnique.mockResolvedValue(existing as never);
      prismaMock.notificationChannel.update.mockResolvedValue({ ...existing, name: "Updated" } as never);

      const result = await caller.updateChannel({ id: "ch-1", name: "Updated" });

      expect(result.name).toBe("Updated");
    });

    it("preserves redacted secrets when config is provided without them", async () => {
      const existing = makeChannel({
        config: { webhookUrl: "https://hooks.slack.com/old", smtpPass: "old-secret" },
      });
      prismaMock.notificationChannel.findUnique.mockResolvedValue(existing as never);
      prismaMock.notificationChannel.update.mockResolvedValue(existing as never);

      await caller.updateChannel({
        id: "ch-1",
        config: { webhookUrl: "https://hooks.slack.com/new" },
      });

      const updateCall = prismaMock.notificationChannel.update.mock.calls[0][0];
      const updatedConfig = (updateCall as { data: { config: Record<string, unknown> } }).data.config;
      expect(updatedConfig.smtpPass).toBe("old-secret");
    });

    it("throws NOT_FOUND for missing channel", async () => {
      prismaMock.notificationChannel.findUnique.mockResolvedValue(null);

      await expect(
        caller.updateChannel({ id: "ch-missing", name: "Updated" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("validates URL when updating slack config with new webhookUrl", async () => {
      const existing = makeChannel();
      prismaMock.notificationChannel.findUnique.mockResolvedValue(existing as never);
      prismaMock.notificationChannel.update.mockResolvedValue(existing as never);

      await caller.updateChannel({
        id: "ch-1",
        config: { webhookUrl: "https://hooks.slack.com/new" },
      });

      expect(mockValidatePublicUrl).toHaveBeenCalledWith("https://hooks.slack.com/new");
    });

    it("re-encrypts hmacSecret when rotated via update", async () => {
      const existing = makeChannel({
        type: "webhook",
        config: { url: "https://x", hmacSecret: "vfenc1:v2:OLDCIPHERTEXT" },
      });
      prismaMock.notificationChannel.findUnique.mockResolvedValue(existing as never);
      prismaMock.notificationChannel.update.mockResolvedValue(existing as never);

      await caller.updateChannel({
        id: "ch-1",
        config: { url: "https://x", hmacSecret: "new-raw" },
      });

      const updateCall = prismaMock.notificationChannel.update.mock.calls[0][0];
      const persisted = (updateCall as { data: { config: Record<string, unknown> } }).data.config;
      expect(persisted.hmacSecret).toMatch(/^vfenc1:/);
      expect(persisted.hmacSecret).not.toBe("vfenc1:v2:OLDCIPHERTEXT");
    });

    it("preserves existing encrypted hmacSecret when not in input", async () => {
      const existing = makeChannel({
        type: "webhook",
        config: { url: "https://x", hmacSecret: "vfenc1:v2:OLDCIPHERTEXT" },
      });
      prismaMock.notificationChannel.findUnique.mockResolvedValue(existing as never);
      prismaMock.notificationChannel.update.mockResolvedValue(existing as never);

      await caller.updateChannel({
        id: "ch-1",
        config: { url: "https://newurl" },
      });

      const updateCall = prismaMock.notificationChannel.update.mock.calls[0][0];
      const persisted = (updateCall as { data: { config: Record<string, unknown> } }).data.config;
      expect(persisted.hmacSecret).toBe("vfenc1:v2:OLDCIPHERTEXT");
    });
  });

  // ─── deleteChannel ─────────────────────────────────────────────────────────

  describe("deleteChannel", () => {
    it("deletes an existing channel", async () => {
      prismaMock.notificationChannel.findUnique.mockResolvedValue(makeChannel() as never);
      prismaMock.notificationChannel.delete.mockResolvedValue(makeChannel() as never);

      const result = await caller.deleteChannel({ id: "ch-1" });

      expect(result).toEqual({ deleted: true });
      expect(prismaMock.notificationChannel.delete).toHaveBeenCalledWith({ where: { id: "ch-1" } });
    });

    it("throws NOT_FOUND for missing channel", async () => {
      prismaMock.notificationChannel.findUnique.mockResolvedValue(null);

      await expect(
        caller.deleteChannel({ id: "ch-missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── testChannel ───────────────────────────────────────────────────────────

  describe("testChannel", () => {
    it("tests a channel and returns success", async () => {
      prismaMock.notificationChannel.findUnique.mockResolvedValue(makeChannel() as never);
      mockChannelTest.mockResolvedValue({ success: true });

      const result = await caller.testChannel({ id: "ch-1" });

      expect(result.success).toBe(true);
    });

    it("returns error details when channel test fails", async () => {
      prismaMock.notificationChannel.findUnique.mockResolvedValue(makeChannel() as never);
      mockChannelTest.mockResolvedValue({ success: false, error: "Connection refused" });

      const result = await caller.testChannel({ id: "ch-1" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
    });

    it("catches driver exceptions and returns error", async () => {
      prismaMock.notificationChannel.findUnique.mockResolvedValue(makeChannel() as never);
      mockChannelTest.mockRejectedValue(new Error("Network timeout"));

      const result = await caller.testChannel({ id: "ch-1" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network timeout");
    });

    it("throws NOT_FOUND for missing channel", async () => {
      prismaMock.notificationChannel.findUnique.mockResolvedValue(null);

      await expect(
        caller.testChannel({ id: "ch-missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("decrypts hmacSecret before passing config to driver.test", async () => {
      const encryptedSecret = ENCRYPTED_MARKER + encrypt("raw-secret", ENCRYPTION_DOMAINS.SECRETS);
      expect(encryptedSecret.startsWith("vfenc1:")).toBe(true);

      prismaMock.notificationChannel.findUnique.mockResolvedValue(
        makeChannel({
          type: "webhook",
          config: {
            url: "https://hooks.example.com/x",
            hmacSecret: encryptedSecret,
          },
        }) as never,
      );
      mockChannelTest.mockResolvedValue({ success: true });

      await caller.testChannel({ id: "ch-1" });

      expect(mockChannelTest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://hooks.example.com/x",
          hmacSecret: "raw-secret",
        }),
      );
    });
  });
});
