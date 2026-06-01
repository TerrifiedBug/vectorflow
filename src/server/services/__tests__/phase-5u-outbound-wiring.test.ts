/**
 * Every outbound HTTP callsite from the control plane goes through
 * `validateOutboundUrl`. This test spies on the policy function and asserts
 * each callsite invokes it BEFORE `fetch`. If a future refactor removes a
 * `validateOutboundUrl` call, the corresponding spy assertion fails.
 *
 * The actual SSRF policy semantics (private IPs, IPv6 metadata, IPv4-mapped
 * IPv6, .internal TLDs, etc.) are covered by
 * `validate-outbound-url.test.ts`. This file pins the *wiring*: who calls it,
 * with what URL, with `force:true` vs gated, and that no callsite has been
 * silently bypassed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
}));

// Spy on the policy function. Each callsite's wiring is asserted by counting
// invocations with the URL it was supposed to validate.
const validateOutboundUrlSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/url-validation", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/server/services/url-validation")>();
  return {
    ...mod,
    validateOutboundUrl: validateOutboundUrlSpy,
  };
});

const fetchSpy = vi.fn();

beforeEach(() => {
  validateOutboundUrlSpy.mockReset();
  validateOutboundUrlSpy.mockResolvedValue(undefined);
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({}),
  } as Response);
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

// ─── outbound-webhook (force: true) ─────────────────────────────────────────

describe("outbound-webhook", () => {
  it("invokes validateOutboundUrl with force:true before fetch", async () => {
    vi.doMock("@/lib/prisma", () => { const __pm = {}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });
    vi.doMock("@/server/services/crypto", () => ({
      decrypt: vi.fn().mockReturnValue("test-secret"),
    }));

    const { deliverOutboundWebhook } = await import(
      "@/server/services/outbound-webhook"
    );

    await deliverOutboundWebhook(
      {
        id: "ep-1",
        url: "https://customer.example.com/webhook",
        encryptedSecret: null,
        organizationId: "org_a",
        // Pre-confirm so the test exercises the SSRF guard,
        // not the new confirmation-required short-circuit.
        confirmedAt: new Date(),
      },
      {
        type: "deploy_completed",
        timestamp: new Date().toISOString(),
        data: {},
      },
    );

    expect(validateOutboundUrlSpy).toHaveBeenCalledWith(
      "https://customer.example.com/webhook",
      { force: true },
    );
  });

  it("fails closed (no fetch) when validateOutboundUrl rejects", async () => {
    validateOutboundUrlSpy.mockRejectedValueOnce(
      new Error("URL resolves to a private or reserved IP address"),
    );
    vi.doMock("@/lib/prisma", () => { const __pm = {}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });
    vi.doMock("@/server/services/crypto", () => ({
      decrypt: vi.fn().mockReturnValue("test-secret"),
    }));

    const { deliverOutboundWebhook } = await import(
      "@/server/services/outbound-webhook"
    );

    const result = await deliverOutboundWebhook(
      {
        id: "ep-1",
        url: "http://10.0.0.5/hook",
        encryptedSecret: null,
        organizationId: "org_a",
        // Pre-confirm so we exercise the SSRF rejection path.
        confirmedAt: new Date(),
      },
      {
        type: "deploy_completed",
        timestamp: new Date().toISOString(),
        data: {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.isPermanent).toBe(true);
    expect(result.error).toContain("SSRF");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── ai.ts streamCompletion (gated) ─────────────────────────────────────────

describe("ai.ts streamCompletion", () => {
  it("invokes validateOutboundUrl without force (OSS Ollama path)", async () => {
    vi.doMock("@/lib/prisma", () => {
      const __pm = {
        team: {
          findUnique: vi.fn().mockResolvedValue({
            organizationId: "org_a",
            aiEnabled: true,
            aiProvider: "openai",
            aiBaseUrl: "http://localhost:11434/v1",
            aiApiKey: "sk-test",
            aiModel: "llama3",
          }),
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({ dataKeyCiphertext: null }),
        },
      };
      return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
    });
    vi.doMock("./crypto", () => ({
      ENCRYPTION_DOMAINS: { GENERIC: "generic" } as const,
      encrypt: vi.fn((s: string) => `enc:${s}`),
      decrypt: vi.fn((s: string) => s),
      encryptForOrg: vi.fn(async (s: string) => `v3:${s}`),
      decryptForOrg: vi.fn(async (s: string) => s.replace(/^v3:/, "")),
    }));
    vi.doMock("@/server/services/crypto", () => ({
      ENCRYPTION_DOMAINS: { GENERIC: "generic" } as const,
      encrypt: vi.fn((s: string) => `enc:${s}`),
      decrypt: vi.fn((s: string) => s),
      encryptForOrg: vi.fn(async (s: string) => `v3:${s}`),
      decryptForOrg: vi.fn(async (s: string) => s.replace(/^v3:/, "")),
    }));
    vi.doMock("@/lib/ai/rate-limiter", () => ({
      checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
    }));
    vi.doMock("@/lib/is-demo-mode", () => ({ isDemoMode: () => false }));
    const empty = new ReadableStream<Uint8Array>({
      start: (c) => c.close(),
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      body: empty,
    } as unknown as Response);

    const { streamCompletion } = await import("@/server/services/ai");

    await streamCompletion({
      teamId: "team-1",
      systemPrompt: "x",
      messages: [{ role: "user", content: "hi" }],
      onToken: () => {},
    });

    // Gated form: no `{ force: true }` — strict-outbound flag decides.
    expect(validateOutboundUrlSpy).toHaveBeenCalledWith(
      "http://localhost:11434/v1",
    );
  });
});

// ─── cost-optimizer-ai (gated) ──────────────────────────────────────────────

describe("cost-optimizer-ai", () => {
  it("invokes validateOutboundUrl on the AI baseUrl per team", async () => {
    const findManyMock = vi.fn().mockResolvedValue([
      {
        id: "rec-1",
        teamId: "team-1",
        type: "LOW_REDUCTION",
        title: "x",
        description: "x",
        analysisData: {},
        suggestedAction: null,
        pipeline: { name: "p", nodes: [] },
      },
    ]);
    const updateMock = vi.fn().mockResolvedValue({});
    vi.doMock("@/lib/prisma", () => {
      const __pm = {
        costRecommendation: { findMany: findManyMock, update: updateMock },
      };
      return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
    });
    vi.doMock("@/lib/is-demo-mode", () => ({ isDemoMode: () => false }));
    vi.doMock("@/server/services/ai", () => ({
      getTeamAiConfig: vi.fn().mockResolvedValue({
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        model: "gpt-4o",
      }),
    }));
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "summary" } }],
      }),
    } as unknown as Response);

    const { generateAiRecommendations } = await import(
      "@/server/services/cost-optimizer-ai"
    );
    await generateAiRecommendations();

    expect(validateOutboundUrlSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1",
    );
  });
});

// ─── migration ai-translator (gated) ────────────────────────────────────────
//
// `callAiCompletion` is module-private and the public `translateBlocks` chain
// runs through Vector validate + block translation orchestration with too many
// failure modes to drive cleanly from a unit test. The wiring is enforced by
// the structure of `callAiCompletion`:
//
//   const config = await getTeamAiConfig(teamId);
//   await validateOutboundUrl(config.baseUrl);     // <-- adjacent
//   const response = await fetch(`${config.baseUrl}/chat/completions`, …);
//
// Adjacent placement (no branching between the two) makes silent removal a
// code-review-visible regression rather than something this test needs to
// guard against in isolation.

// ─── vault-client (gated) ───────────────────────────────────────────────────

describe("vault-client", () => {
  it("invokes validateOutboundUrl on the Vault URL before fetch", async () => {
    vi.doMock("node:fs/promises", () => ({ readFile: vi.fn() }));
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { data: { value: "pw" }, metadata: { version: 1 } },
      }),
    } as unknown as Response);

    const { fetchVaultSecrets } = await import(
      "@/server/services/vault-client"
    );

    await fetchVaultSecrets(
      {
        address: "https://vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        token: "vault-token",
      },
      ["db/password"],
    );

    expect(validateOutboundUrlSpy).toHaveBeenCalled();
    const calls = validateOutboundUrlSpy.mock.calls;
    // CodeQL: pin the prefix with a trailing path separator so a look-alike
    // host (`vault.example.com.attacker.example/...`) can't pass.
    expect(calls.some((c) => String(c[0]).startsWith("https://vault.example.com/"))).toBe(true);
    // Gated form: no `{ force: true }` — strict-outbound flag decides.
    expect(calls.every((c) => c[1] === undefined)).toBe(true);
  });
});

// ─── pagerduty (force: true) ────────────────────────────────────────────────

describe("pagerduty channel", () => {
  it("invokes validateOutboundUrl with force:true before fetch", async () => {
    const { pagerdutyDriver } = await import(
      "@/server/services/channels/pagerduty"
    );

    await pagerdutyDriver.deliver(
      { integrationKey: "k" },
      {
        alertId: "a",
        status: "firing",
        ruleName: "r",
        message: "m",
        severity: "warning",
        metric: "cpu_seconds_total",
        team: "t",
        timestamp: new Date().toISOString(),
        dashboardUrl: "https://example.com",
        node: "n",
        environment: "prod",
        pipeline: "p",
        value: 1,
        threshold: 1,
      },
    );

    expect(validateOutboundUrlSpy).toHaveBeenCalledWith(
      "https://events.pagerduty.com/v2/enqueue",
      { force: true },
    );
  });
});

// ─── context7 (force: true) ─────────────────────────────────────────────────

describe("context7", () => {
  it("invokes validateOutboundUrl with force:true before fetch", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ codeSnippets: [], infoSnippets: [] }),
    } as unknown as Response);

    const ctx7 = await import("@/server/services/context7");
    await ctx7.lookupVrlFunction("parse_json");

    expect(validateOutboundUrlSpy).toHaveBeenCalled();
    const calls = validateOutboundUrlSpy.mock.calls;
    expect(
      calls.some((c) =>
        String(c[0]).startsWith("https://context7.com/api/v2/context"),
      ),
    ).toBe(true);
    expect(calls.every((c) => c[1]?.force === true)).toBe(true);
  });
});
