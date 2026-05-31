import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import * as cryptoMod from "@/server/services/crypto";
import * as urlValidation from "@/server/services/url-validation";
import crypto from "crypto";

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/crypto", () => ({
  ENCRYPTION_DOMAINS: { GENERIC: "generic" } as const,
  decrypt: vi.fn().mockReturnValue("test-secret"),
  encrypt: vi.fn(),
  encryptForOrg: vi.fn(async () => "v3:test-secret"),
  decryptForOrg: vi.fn(async () => "test-secret"),
}));

vi.mock("@/server/services/url-validation", () => ({
  validateOutboundUrl: vi.fn().mockResolvedValue(undefined),
}));

// `deliverOutboundWebhook` routes through `fetchHardened`
// for per-hop SSRF re-validation + DNS rebinding caching. The existing
// tests are still about the SIGNING + RESULT shape and shouldn't care
// about the hop machinery — replace `fetchHardened` with a thin shim
// over the test-supplied `fetch` spy.
const mockFetchHardened = vi.fn();
vi.mock("@/server/services/webhook-hardened-delivery", () => ({
  fetchHardened: (...args: unknown[]) => mockFetchHardened(...args),
  WebhookRedirectError: class WebhookRedirectError extends Error {
    readonly _tag = "WebhookRedirectError" as const;
  },
  DnsRebindingError: class DnsRebindingError extends Error {
    readonly _tag = "DnsRebindingError" as const;
  },
  _resetDnsCache: vi.fn(),
  resolveHostnamePublic: vi.fn().mockResolvedValue(["8.8.8.8"]),
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
  organizationId: string;
  confirmedAt: Date | null;
}> = {}) {
  return {
    id: "ep-1",
    url: "https://example.com/webhook",
    encryptedSecret: "encrypted-secret",
    teamId: "team-1",
    organizationId: "default",
    name: "Test Endpoint",
    eventTypes: [AlertMetric.deploy_completed],
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    confirmedAt: new Date("2026-01-01"),
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
    vi.mocked(urlValidation.validateOutboundUrl).mockResolvedValue(undefined);
    vi.mocked(cryptoMod.decrypt).mockReturnValue("test-secret");
    // Shim: route mockFetchHardened through the global `fetch` spy so the
    // existing tests (which still stubGlobal("fetch", …)) keep working
    // without rewriting every assertion against the hardened-delivery API.
    mockFetchHardened.mockImplementation(async (url: string, init: RequestInit) => {
      const res = await fetch(url, init);
      return { status: res.status, ok: res.ok, redirectChain: [url] };
    });
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

  it("delegates redirect handling to fetchHardened", async () => {
    // Previously the test asserted `init.redirect === "manual"` on the
    // direct fetch call. The redirect policy is now encapsulated in
    // `fetchHardened` (max 3 hops, per-hop re-validation, no protocol
    // downgrade). The assertion: `deliverOutboundWebhook` ALWAYS routes
    // through `fetchHardened` rather than calling the raw `fetch` directly.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchSpy);

    await deliverOutboundWebhook(makeEndpoint(), samplePayload);

    expect(mockFetchHardened).toHaveBeenCalledOnce();
    const [url] = mockFetchHardened.mock.calls[0] as [string, unknown];
    expect(url).toBe("https://example.com/webhook");
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
    vi.mocked(urlValidation.validateOutboundUrl).mockRejectedValue(
      new Error("URL resolves to a private or reserved IP address"),
    );

    const result = await deliverOutboundWebhook(makeEndpoint(), samplePayload);
    expect(result.success).toBe(false);
    expect(result.isPermanent).toBe(true);
    expect(result.error).toContain("SSRF");
  });

  // Codex P2 / PR #335 follow-up: DNS-rebinding-policy violations must
  // be classified as permanent so the retry loop dead-letters them. Before
  // the typed `DnsRebindingError`, these slipped through as retryable.
  it("returns isPermanent true when fetchHardened throws DnsRebindingError (no answer)", async () => {
    const { DnsRebindingError } = await import(
      "@/server/services/webhook-hardened-delivery"
    );
    mockFetchHardened.mockRejectedValueOnce(
      new DnsRebindingError("DNS: hostname nx.example did not resolve"),
    );

    const result = await deliverOutboundWebhook(makeEndpoint(), samplePayload);
    expect(result.success).toBe(false);
    expect(result.isPermanent).toBe(true);
    expect(result.error).toMatch(/DNS/);
  });

  it("returns isPermanent true when fetchHardened throws DnsRebindingError (split-answer rebinding)", async () => {
    const { DnsRebindingError } = await import(
      "@/server/services/webhook-hardened-delivery"
    );
    mockFetchHardened.mockRejectedValueOnce(
      new DnsRebindingError(
        "DNS: hostname rebind.example resolved to a private IP (10.0.0.1); treating as rebinding attempt",
      ),
    );

    const result = await deliverOutboundWebhook(makeEndpoint(), samplePayload);
    expect(result.success).toBe(false);
    expect(result.isPermanent).toBe(true);
    expect(result.error).toMatch(/rebinding/);
  });

  it("never calls fetch when NEXT_PUBLIC_VF_DEMO_MODE=true", async () => {
    vi.stubEnv("NEXT_PUBLIC_VF_DEMO_MODE", "true");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await deliverOutboundWebhook(makeEndpoint(), samplePayload);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(urlValidation.validateOutboundUrl)).not.toHaveBeenCalled();
    expect(result.success).toBe(true);

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
    vi.mocked(urlValidation.validateOutboundUrl).mockResolvedValue(undefined);
    vi.mocked(cryptoMod.decrypt).mockReturnValue("test-secret");
    mockFetchHardened.mockImplementation(async (url: string, init: RequestInit) => {
      const res = await fetch(url, init);
      return { status: res.status, ok: res.ok, redirectChain: [url] };
    });
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
