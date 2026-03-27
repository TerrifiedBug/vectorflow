import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import * as cryptoMod from "@/server/services/crypto";
import * as urlValidation from "@/server/services/url-validation";
import crypto from "crypto";

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/crypto", () => ({
  decrypt: vi.fn().mockReturnValue("test-secret"),
  encrypt: vi.fn(),
}));

vi.mock("@/server/services/url-validation", () => ({
  validatePublicUrl: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import after mocks ────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  deliverOutboundWebhook,
  fireOutboundWebhooks,
  isPermanentFailure,
} from "@/server/services/outbound-webhook";
import { AlertMetric } from "@/generated/prisma";

const mockPrisma = prisma as ReturnType<typeof mockDeep<PrismaClient>>;

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<{
  id: string;
  url: string;
  encryptedSecret: string | null;
  teamId: string;
  name: string;
  eventTypes: AlertMetric[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: "ep-1",
    url: "https://example.com/webhook",
    encryptedSecret: "encrypted-secret",
    teamId: "team-1",
    name: "Test Endpoint",
    eventTypes: [AlertMetric.deploy_completed],
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const samplePayload = {
  type: "deploy_completed",
  timestamp: new Date().toISOString(),
  data: { pipelineId: "pipe-1" },
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("deliverOutboundWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(urlValidation.validatePublicUrl).mockResolvedValue(undefined);
    vi.mocked(cryptoMod.decrypt).mockReturnValue("test-secret");
  });

  it("signs payload with Standard-Webhooks headers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const endpoint = makeEndpoint();
    const result = await deliverOutboundWebhook(endpoint, samplePayload);

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    // webhook-id must be a UUID
    expect(headers["webhook-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // webhook-timestamp must be an integer seconds string
    const ts = parseInt(headers["webhook-timestamp"], 10);
    expect(isNaN(ts)).toBe(false);
    expect(String(ts)).toBe(headers["webhook-timestamp"]);
    expect(ts).toBeGreaterThan(1_700_000_000); // sanity: after Nov 2023

    // webhook-signature must be v1,{base64}
    expect(headers["webhook-signature"]).toMatch(/^v1,[A-Za-z0-9+/=]+$/);

    // Independently verify HMAC correctness
    const msgId = headers["webhook-id"];
    const timestamp = headers["webhook-timestamp"];
    const body = init.body as string;
    const signingString = `${msgId}.${timestamp}.${body}`;
    const expectedSig = crypto
      .createHmac("sha256", "test-secret")
      .update(signingString)
      .digest("base64");
    expect(headers["webhook-signature"]).toBe(`v1,${expectedSig}`);
  });

  it("uses same body string for signing and fetch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const endpoint = makeEndpoint();
    await deliverOutboundWebhook(endpoint, samplePayload);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;

    const msgId = headers["webhook-id"];
    const timestamp = headers["webhook-timestamp"];
    const sig = headers["webhook-signature"].replace("v1,", "");

    const signingString = `${msgId}.${timestamp}.${body}`;
    const expectedSig = crypto
      .createHmac("sha256", "test-secret")
      .update(signingString)
      .digest("base64");

    expect(sig).toBe(expectedSig);
  });

  it("classifies 4xx non-429 as permanent failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
    }));

    const result = await deliverOutboundWebhook(makeEndpoint(), samplePayload);
    expect(result.success).toBe(false);
    expect(result.isPermanent).toBe(true);
    expect(result.statusCode).toBe(400);
  });

  it("classifies 429 as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    }));

    const result = await deliverOutboundWebhook(makeEndpoint(), samplePayload);
    expect(result.success).toBe(false);
    expect(result.isPermanent).toBe(false);
    expect(result.statusCode).toBe(429);
  });

  it("classifies 5xx as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }));

    const result = await deliverOutboundWebhook(makeEndpoint(), samplePayload);
    expect(result.success).toBe(false);
    expect(result.isPermanent).toBe(false);
    expect(result.statusCode).toBe(503);
  });

  it("classifies DNS failure as permanent", async () => {
    const dnsError = new Error("getaddrinfo ENOTFOUND example.com");
    dnsError.name = "Error";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(dnsError));

    const result = await deliverOutboundWebhook(makeEndpoint(), samplePayload);
    expect(result.success).toBe(false);
    expect(result.isPermanent).toBe(true);
  });

  it("classifies timeout as retryable", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await deliverOutboundWebhook(makeEndpoint(), samplePayload);
    expect(result.success).toBe(false);
    expect(result.isPermanent).toBe(false);
  });

  it("returns isPermanent true for SSRF violation", async () => {
    const { TRPCError } = await import("@trpc/server");
    vi.mocked(urlValidation.validatePublicUrl).mockRejectedValue(
      new TRPCError({ code: "BAD_REQUEST", message: "URL resolves to a private or reserved IP address" }),
    );

    const result = await deliverOutboundWebhook(makeEndpoint(), samplePayload);
    expect(result.success).toBe(false);
    expect(result.isPermanent).toBe(true);
    expect(result.error).toContain("SSRF");
  });
});

describe("isPermanentFailure", () => {
  it("returns true for 4xx non-429", () => {
    expect(isPermanentFailure({ success: false, statusCode: 400, isPermanent: true })).toBe(true);
    expect(isPermanentFailure({ success: false, statusCode: 404, isPermanent: true })).toBe(true);
    expect(isPermanentFailure({ success: false, statusCode: 403, isPermanent: true })).toBe(true);
  });

  it("returns false for 429", () => {
    expect(isPermanentFailure({ success: false, statusCode: 429, isPermanent: false })).toBe(false);
  });

  it("returns false for 5xx", () => {
    expect(isPermanentFailure({ success: false, statusCode: 500, isPermanent: false })).toBe(false);
    expect(isPermanentFailure({ success: false, statusCode: 503, isPermanent: false })).toBe(false);
  });

  it("returns true for ENOTFOUND error", () => {
    expect(isPermanentFailure({ success: false, error: "getaddrinfo ENOTFOUND host", isPermanent: true })).toBe(true);
  });

  it("returns true for ECONNREFUSED error", () => {
    expect(isPermanentFailure({ success: false, error: "connect ECONNREFUSED 127.0.0.1:80", isPermanent: true })).toBe(true);
  });
});

describe("dispatchWithTracking (via fireOutboundWebhooks behavior)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(urlValidation.validatePublicUrl).mockResolvedValue(undefined);
    vi.mocked(cryptoMod.decrypt).mockReturnValue("test-secret");
  });

  it("dispatchWithTracking sets dead_letter for permanent failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
    }));

    const deliveryId = "delivery-1";
    mockPrisma.webhookDelivery.create.mockResolvedValue({
      id: deliveryId,
      webhookEndpointId: "ep-1",
      eventType: AlertMetric.deploy_completed,
      msgId: "msg-1",
      payload: {},
      status: "pending",
      statusCode: null,
      errorMessage: null,
      attemptNumber: 1,
      nextRetryAt: null,
      requestedAt: new Date(),
      completedAt: null,
    });
    mockPrisma.webhookDelivery.update.mockResolvedValue({} as never);

    mockPrisma.webhookEndpoint.findMany.mockResolvedValue([makeEndpoint()]);

    await fireOutboundWebhooks(AlertMetric.deploy_completed, "team-1", samplePayload);

    expect(mockPrisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: deliveryId },
        data: expect.objectContaining({
          status: "dead_letter",
          nextRetryAt: null,
        }),
      }),
    );
  });

  it("dispatchWithTracking sets failed with nextRetryAt for retryable failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }));

    const deliveryId = "delivery-2";
    mockPrisma.webhookDelivery.create.mockResolvedValue({
      id: deliveryId,
      webhookEndpointId: "ep-1",
      eventType: AlertMetric.deploy_completed,
      msgId: "msg-2",
      payload: {},
      status: "pending",
      statusCode: null,
      errorMessage: null,
      attemptNumber: 1,
      nextRetryAt: null,
      requestedAt: new Date(),
      completedAt: null,
    });
    mockPrisma.webhookDelivery.update.mockResolvedValue({} as never);

    mockPrisma.webhookEndpoint.findMany.mockResolvedValue([makeEndpoint()]);

    await fireOutboundWebhooks(AlertMetric.deploy_completed, "team-1", samplePayload);

    expect(mockPrisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: deliveryId },
        data: expect.objectContaining({
          status: "failed",
          nextRetryAt: expect.any(Date),
        }),
      }),
    );
  });
});
