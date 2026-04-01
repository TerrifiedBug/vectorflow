import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/url-validation", () => ({
  validatePublicUrl: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  formatWebhookMessage,
  deliverSingleWebhook,
  deliverWebhooks,
  type WebhookPayload,
} from "@/server/services/webhook-delivery";
import * as urlValidation from "@/server/services/url-validation";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    alertId: "alert-1",
    status: "firing",
    ruleName: "CPU High",
    severity: "warning",
    environment: "Production",
    team: "Platform",
    node: "node-1.example.com",
    pipeline: "Logs Pipeline",
    metric: "cpu_usage",
    value: 92.5,
    threshold: 80,
    message: "CPU usage is 92.50 (threshold: > 80)",
    timestamp: "2026-03-31T12:00:00.000Z",
    dashboardUrl: "https://vf.example.com/alerts",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("webhook-delivery", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── formatWebhookMessage ─────────────────────────────────────────────────

  describe("formatWebhookMessage", () => {
    it("formats a firing alert with all fields", () => {
      const payload = makePayload();
      const message = formatWebhookMessage(payload);

      expect(message).toContain("FIRING");
      expect(message).toContain("CPU High");
      expect(message).toContain("CPU usage is 92.50");
      expect(message).toContain("node-1.example.com");
      expect(message).toContain("Logs Pipeline");
      expect(message).toContain("Production");
      expect(message).toContain("Platform");
    });

    it("formats a resolved alert", () => {
      const payload = makePayload({ status: "resolved" });
      const message = formatWebhookMessage(payload);

      expect(message).toContain("RESOLVED");
      expect(message).not.toContain("FIRING");
    });

    it("omits optional fields when not provided", () => {
      const payload = makePayload({
        node: undefined,
        pipeline: undefined,
        team: undefined,
      });
      const message = formatWebhookMessage(payload);

      expect(message).not.toContain("**Node:**");
      expect(message).not.toContain("**Pipeline:**");
      expect(message).not.toContain("**Team:**");
    });
  });

  // ─── deliverSingleWebhook ─────────────────────────────────────────────────

  describe("deliverSingleWebhook", () => {
    it("delivers successfully to a webhook", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await deliverSingleWebhook(
        { url: "https://hooks.example.com/webhook", headers: null, hmacSecret: null },
        makePayload(),
      );

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://hooks.example.com/webhook",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("returns failure when webhook responds with error status", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await deliverSingleWebhook(
        { url: "https://hooks.example.com/webhook", headers: null, hmacSecret: null },
        makePayload(),
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toContain("HTTP 500");

      vi.unstubAllGlobals();
    });

    it("adds HMAC signature when hmacSecret is provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      await deliverSingleWebhook(
        { url: "https://hooks.example.com/webhook", headers: null, hmacSecret: "my-secret" },
        makePayload(),
      );

      const fetchCall = mockFetch.mock.calls[0];
      const sentHeaders = fetchCall[1].headers as Record<string, string>;
      expect(sentHeaders["X-VectorFlow-Signature"]).toBeDefined();
      expect(sentHeaders["X-VectorFlow-Signature"]).toMatch(/^sha256=/);

      vi.unstubAllGlobals();
    });

    it("includes custom headers from webhook config", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      await deliverSingleWebhook(
        {
          url: "https://hooks.example.com/webhook",
          headers: { Authorization: "Bearer token123" },
          hmacSecret: null,
        },
        makePayload(),
      );

      const fetchCall = mockFetch.mock.calls[0];
      const sentHeaders = fetchCall[1].headers as Record<string, string>;
      expect(sentHeaders["Authorization"]).toBe("Bearer token123");

      vi.unstubAllGlobals();
    });

    it("returns failure when URL validation rejects (SSRF protection)", async () => {
      vi.mocked(urlValidation.validatePublicUrl).mockRejectedValueOnce(
        new Error("Private IP address"),
      );

      const result = await deliverSingleWebhook(
        { url: "http://192.168.1.1/webhook", headers: null, hmacSecret: null },
        makePayload(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("private/reserved IP");
    });

    it("returns failure when fetch throws (network error)", async () => {
      vi.mocked(urlValidation.validatePublicUrl).mockResolvedValue(undefined);
      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await deliverSingleWebhook(
        { url: "https://hooks.example.com/webhook", headers: null, hmacSecret: null },
        makePayload(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Connection refused");

      vi.unstubAllGlobals();
    });
  });

  // ─── deliverWebhooks ──────────────────────────────────────────────────────

  describe("deliverWebhooks", () => {
    it("delivers to all enabled webhooks for an environment", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      prismaMock.alertWebhook.findMany.mockResolvedValue([
        { id: "wh-1", url: "https://a.example.com/hook", headers: null, hmacSecret: null, enabled: true },
        { id: "wh-2", url: "https://b.example.com/hook", headers: null, hmacSecret: null, enabled: true },
      ] as never);

      await deliverWebhooks("env-1", makePayload());

      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.unstubAllGlobals();
    });

    it("continues delivering to remaining webhooks when one fails", async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      prismaMock.alertWebhook.findMany.mockResolvedValue([
        { id: "wh-1", url: "https://failing.example.com/hook", headers: null, hmacSecret: null, enabled: true },
        { id: "wh-2", url: "https://working.example.com/hook", headers: null, hmacSecret: null, enabled: true },
      ] as never);

      // Should not throw — errors are logged but delivery continues
      await deliverWebhooks("env-1", makePayload());

      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.unstubAllGlobals();
    });
  });
});
