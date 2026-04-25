import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// Mock prisma using factory (avoids hoisting issues with top-level variables)
vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

// Sentry mock — use vi.fn() inside factory, access via vi.mocked() after imports.
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

// Import after mocks are declared so vi.mock hoisting resolves correctly.
import { prisma } from "@/lib/prisma";
import * as Sentry from "@sentry/nextjs";
import { sendTelemetryHeartbeat, _resetSenderState } from "../telemetry-sender";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const sentryCapture = vi.mocked(Sentry.captureException);

// SystemSettings fields used by the sender.
// Note: there is no oidcEnabled boolean in the schema — OIDC is detected via
// oidcIssuer being non-null/non-empty.
const enabledSettings = {
  id: "singleton",
  telemetryEnabled: true,
  telemetryInstanceId: "01HX0000000000000000000000",
  telemetryEnabledAt: new Date("2026-04-25T10:00:00.000Z"),
  oidcIssuer: null, // null → credentials auth method
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetSenderState();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubEnv("VF_VERSION", "1.4.2");
  vi.stubEnv("VF_DEPLOYMENT_MODE", "docker");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Helper: mock the three pipeline counts (draft, active, paused) and vectorNode count.
// Pipeline model uses isDraft (boolean) + deployedAt (DateTime?) — no status enum.
//   draft   = isDraft: true
//   active  = isDraft: false, deployedAt: not null
//   paused  = isDraft: false, deployedAt: null
// VectorFlow fleet agents are VectorNode records (no Agent/FleetAgent model in schema).
function mockCounts(draft: number, active: number, paused: number, nodes: number) {
  prismaMock.pipeline.count
    .mockResolvedValueOnce(draft)   // where: { isDraft: true }
    .mockResolvedValueOnce(active)  // where: { isDraft: false, deployedAt: { not: null } }
    .mockResolvedValueOnce(paused); // where: { isDraft: false, deployedAt: null }
  prismaMock.vectorNode.count.mockResolvedValueOnce(nodes);
}

describe("sendTelemetryHeartbeat — happy path", () => {
  it("POSTs a V1 payload to the Pulse URL when telemetry is enabled", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValueOnce(enabledSettings as never);
    mockCounts(3, 12, 2, 5);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 204 })
    );

    await sendTelemetryHeartbeat();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://pulse.terrifiedbug.com/api/v1/ping");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.schema_version).toBe(1);
    expect(body.instance_id).toBe("01HX0000000000000000000000");
    expect(body.vf_version).toBe("1.4.2");
    expect(body.agent_count).toBe(5);
    expect(body.pipeline_count).toEqual({ active: 12, paused: 2, draft: 3 });
    expect(body.auth_method).toBe("credentials");
    expect(body.deployment_mode).toBe("docker");
  });

  it("no-ops when telemetryEnabled is false", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValueOnce({
      ...enabledSettings,
      telemetryEnabled: false,
      telemetryInstanceId: null,
      telemetryEnabledAt: null,
    } as never);

    await sendTelemetryHeartbeat();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("no-ops when telemetryInstanceId is missing even if enabled", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValueOnce({
      ...enabledSettings,
      telemetryEnabled: true,
      telemetryInstanceId: null,
      telemetryEnabledAt: null,
    } as never);

    await sendTelemetryHeartbeat();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses oidc auth_method when oidcIssuer is set", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValueOnce({
      ...enabledSettings,
      oidcIssuer: "https://sso.example.com",
    } as never);
    mockCounts(0, 0, 0, 0);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 204 })
    );

    await sendTelemetryHeartbeat();

    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const body = JSON.parse(init.body as string);
    expect(body.auth_method).toBe("oidc");
  });

  it("falls back to 'unknown' for missing env vars", async () => {
    vi.unstubAllEnvs();
    prismaMock.systemSettings.findUnique.mockResolvedValueOnce(enabledSettings as never);
    mockCounts(0, 0, 0, 0);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 204 })
    );

    await sendTelemetryHeartbeat();

    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const body = JSON.parse(init.body as string);
    expect(body.vf_version).toBe("unknown");
    expect(body.deployment_mode).toBe("unknown");
  });

  it("no-ops when VF_DEMO_MODE=true regardless of DB telemetryEnabled", async () => {
    vi.stubEnv("VF_DEMO_MODE", "true");
    vi.resetModules();
    // Re-import to pick up the new env value via the env module's lazy Proxy
    const { sendTelemetryHeartbeat: senderWithDemo } = await import("../telemetry-sender");

    prismaMock.systemSettings.findUnique.mockResolvedValue(enabledSettings as never);

    await senderWithDemo();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("sendTelemetryHeartbeat — failure paths", () => {
  it("logs and Sentry-captures on network error, does not throw", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValueOnce(enabledSettings as never);
    mockCounts(0, 0, 0, 0);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("fetch failed")
    );

    await expect(sendTelemetryHeartbeat()).resolves.toBeUndefined();
    expect(sentryCapture).toHaveBeenCalledOnce();
  });

  it("logs and Sentry-captures on non-2xx response that isn't 503", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValueOnce(enabledSettings as never);
    mockCounts(0, 0, 0, 0);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 500 })
    );

    await sendTelemetryHeartbeat();
    expect(sentryCapture).toHaveBeenCalledOnce();
  });

  it("on 503 with Retry-After, suppresses next call within the retry window", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(enabledSettings as never);
    mockCounts(0, 0, 0, 0);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 503, headers: { "retry-after": "3600" } })
    );

    await sendTelemetryHeartbeat();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Second call within the retry window must NOT hit fetch
    await sendTelemetryHeartbeat();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Sentry NOT captured for an in-band 503 — it's a graceful backoff
    expect(sentryCapture).not.toHaveBeenCalled();
  });

  it("on 503 without Retry-After, does not suppress future calls", async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(enabledSettings as never);
    // Need to mock counts twice because two calls will reach the count phase
    mockCounts(0, 0, 0, 0);
    mockCounts(0, 0, 0, 0);
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await sendTelemetryHeartbeat();
    await sendTelemetryHeartbeat();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

// Expose sentryCapture for potential future use in error-path tests
export { sentryCapture };
