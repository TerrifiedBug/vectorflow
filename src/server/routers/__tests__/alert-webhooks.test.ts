import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t, mockValidatePublicUrl, mockFormatWebhookMessage } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return {
    t,
    mockValidatePublicUrl: vi.fn().mockResolvedValue(undefined),
    mockFormatWebhookMessage: vi.fn().mockReturnValue("formatted message"),
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
}));

vi.mock("@/server/services/webhook-delivery", () => ({
  deliverSingleWebhook: vi.fn().mockResolvedValue({ success: true }),
  formatWebhookMessage: mockFormatWebhookMessage,
}));

import { prisma } from "@/lib/prisma";
import { alertWebhooksRouter } from "@/server/routers/alert-webhooks";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(alertWebhooksRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

function makeWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh-1",
    environmentId: "env-1",
    url: "https://hooks.example.com/alert",
    headers: null,
    hmacSecret: null,
    enabled: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

describe("alertWebhooksRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── listWebhooks ─────────────────────────────────────────────────────────

  describe("listWebhooks", () => {
    it("returns webhooks for an environment", async () => {
      prismaMock.alertWebhook.findMany.mockResolvedValue([makeWebhook()] as never);

      const result = await caller.listWebhooks({ environmentId: "env-1" });

      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://hooks.example.com/alert");
    });

    it("returns empty array when no webhooks exist", async () => {
      prismaMock.alertWebhook.findMany.mockResolvedValue([]);

      const result = await caller.listWebhooks({ environmentId: "env-1" });

      expect(result).toEqual([]);
    });
  });

  // ─── createWebhook ────────────────────────────────────────────────────────

  describe("createWebhook", () => {
    it("creates a webhook and validates the URL", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.alertWebhook.create.mockResolvedValue(makeWebhook() as never);

      const result = await caller.createWebhook({
        environmentId: "env-1",
        url: "https://hooks.example.com/alert",
      });

      expect(result.id).toBe("wh-1");
      expect(mockValidatePublicUrl).toHaveBeenCalledWith("https://hooks.example.com/alert");
    });

    it("creates a webhook with custom headers", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.alertWebhook.create.mockResolvedValue(
        makeWebhook({ headers: { Authorization: "Bearer token" } }) as never,
      );

      await caller.createWebhook({
        environmentId: "env-1",
        url: "https://hooks.example.com/alert",
        headers: { Authorization: "Bearer token" },
      });

      expect(prismaMock.alertWebhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            headers: { Authorization: "Bearer token" },
          }),
        }),
      );
    });

    it("creates a webhook with HMAC secret", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.alertWebhook.create.mockResolvedValue(
        makeWebhook({ hmacSecret: "my-secret" }) as never,
      );

      await caller.createWebhook({
        environmentId: "env-1",
        url: "https://hooks.example.com/alert",
        hmacSecret: "my-secret",
      });

      expect(prismaMock.alertWebhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hmacSecret: "my-secret",
          }),
        }),
      );
    });

    it("throws NOT_FOUND if environment does not exist", async () => {
      mockValidatePublicUrl.mockResolvedValue(undefined);
      prismaMock.environment.findUnique.mockResolvedValue(null);

      await expect(
        caller.createWebhook({
          environmentId: "env-missing",
          url: "https://hooks.example.com/alert",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── updateWebhook ────────────────────────────────────────────────────────

  describe("updateWebhook", () => {
    it("updates a webhook URL and validates it", async () => {
      const existing = makeWebhook();
      prismaMock.alertWebhook.findUnique.mockResolvedValue(existing as never);
      prismaMock.alertWebhook.update.mockResolvedValue(
        { ...existing, url: "https://new.example.com/hook" } as never,
      );

      const result = await caller.updateWebhook({
        id: "wh-1",
        url: "https://new.example.com/hook",
      });

      expect(result.url).toBe("https://new.example.com/hook");
      expect(mockValidatePublicUrl).toHaveBeenCalledWith("https://new.example.com/hook");
    });

    it("updates enabled flag without validating URL", async () => {
      const existing = makeWebhook();
      prismaMock.alertWebhook.findUnique.mockResolvedValue(existing as never);
      prismaMock.alertWebhook.update.mockResolvedValue(
        { ...existing, enabled: false } as never,
      );

      await caller.updateWebhook({ id: "wh-1", enabled: false });

      expect(mockValidatePublicUrl).not.toHaveBeenCalled();
    });

    it("sets headers to DbNull when null is provided", async () => {
      const existing = makeWebhook({ headers: { "X-Custom": "value" } });
      prismaMock.alertWebhook.findUnique.mockResolvedValue(existing as never);
      prismaMock.alertWebhook.update.mockResolvedValue(
        { ...existing, headers: null } as never,
      );

      await caller.updateWebhook({ id: "wh-1", headers: null });

      expect(prismaMock.alertWebhook.update).toHaveBeenCalled();
    });

    it("throws NOT_FOUND for missing webhook", async () => {
      prismaMock.alertWebhook.findUnique.mockResolvedValue(null);

      await expect(
        caller.updateWebhook({ id: "wh-missing", url: "https://example.com" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── deleteWebhook ────────────────────────────────────────────────────────

  describe("deleteWebhook", () => {
    it("deletes an existing webhook", async () => {
      prismaMock.alertWebhook.findUnique.mockResolvedValue(makeWebhook() as never);
      prismaMock.alertWebhook.delete.mockResolvedValue(makeWebhook() as never);

      const result = await caller.deleteWebhook({ id: "wh-1" });

      expect(result).toEqual({ deleted: true });
      expect(prismaMock.alertWebhook.delete).toHaveBeenCalledWith({ where: { id: "wh-1" } });
    });

    it("throws NOT_FOUND for missing webhook", async () => {
      prismaMock.alertWebhook.findUnique.mockResolvedValue(null);

      await expect(
        caller.deleteWebhook({ id: "wh-missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── testWebhook ──────────────────────────────────────────────────────────

  describe("testWebhook", () => {
    it("sends a test payload and returns success", async () => {
      const webhook = makeWebhook({
        environment: { name: "production", team: { name: "Platform" } },
      });
      prismaMock.alertWebhook.findUnique.mockResolvedValue(webhook as never);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await caller.testWebhook({ id: "wh-1" });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(mockValidatePublicUrl).toHaveBeenCalledWith("https://hooks.example.com/alert");
      expect(mockFormatWebhookMessage).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("includes HMAC signature when hmacSecret is set", async () => {
      const webhook = makeWebhook({
        hmacSecret: "test-secret",
        environment: { name: "production", team: { name: "Platform" } },
      });
      prismaMock.alertWebhook.findUnique.mockResolvedValue(webhook as never);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      await caller.testWebhook({ id: "wh-1" });

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Record<string, string>;
      expect(headers["X-VectorFlow-Signature"]).toMatch(/^sha256=[a-f0-9]+$/);

      vi.unstubAllGlobals();
    });

    it("returns error when fetch fails", async () => {
      const webhook = makeWebhook({
        environment: { name: "production", team: { name: "Platform" } },
      });
      prismaMock.alertWebhook.findUnique.mockResolvedValue(webhook as never);

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const result = await caller.testWebhook({ id: "wh-1" });

      expect(result.success).toBe(false);
      expect(result.statusText).toBe("Network error");

      vi.unstubAllGlobals();
    });

    it("throws NOT_FOUND for missing webhook", async () => {
      prismaMock.alertWebhook.findUnique.mockResolvedValue(null);

      await expect(
        caller.testWebhook({ id: "wh-missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("includes custom headers from the webhook", async () => {
      const webhook = makeWebhook({
        headers: { "X-Custom-Header": "custom-value" },
        environment: { name: "production", team: { name: "Platform" } },
      });
      prismaMock.alertWebhook.findUnique.mockResolvedValue(webhook as never);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      await caller.testWebhook({ id: "wh-1" });

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Record<string, string>;
      expect(headers["X-Custom-Header"]).toBe("custom-value");
      expect(headers["Content-Type"]).toBe("application/json");

      vi.unstubAllGlobals();
    });
  });
});
