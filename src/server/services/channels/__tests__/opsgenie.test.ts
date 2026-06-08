import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// The Opsgenie endpoints are hardcoded, so the driver guards them with
// validateOutboundUrl (like pagerduty). Mock it to a no-op so tests stay
// hermetic (no DNS / SSRF policy in unit tests).
const { validateOutboundUrlMock } = vi.hoisted(() => ({
  validateOutboundUrlMock: vi.fn(),
}));
vi.mock("@/server/services/url-validation", () => ({
  validateOutboundUrl: validateOutboundUrlMock,
}));

import { opsgenieDriver } from "@/server/services/channels/opsgenie";
import type { ChannelPayload } from "@/server/services/channels/types";

const US_URL = "https://api.opsgenie.com/v2/alerts";
const EU_URL = "https://api.eu.opsgenie.com/v2/alerts";

function makePayload(overrides: Partial<ChannelPayload> = {}): ChannelPayload {
  return {
    alertId: "a1",
    status: "firing",
    ruleName: "High CPU",
    severity: "warning",
    environment: "prod",
    metric: "cpu_usage",
    value: 91,
    threshold: 80,
    message: "CPU 91 > 80",
    timestamp: "2026-06-07T00:00:00.000Z",
    dashboardUrl: "https://app.example.com/alerts",
    ...overrides,
  };
}

let captured: { url?: string; init?: RequestInit };
const fetchMock = vi.fn();

function parsedBody(): Record<string, unknown> {
  return JSON.parse(captured.init?.body as string);
}

describe("opsgenieDriver.deliver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateOutboundUrlMock.mockResolvedValue(undefined);
    captured = {};
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return { ok: true, status: 202, text: async () => "" } as Response;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an alert on the US endpoint by default with GenieKey auth", async () => {
    const result = await opsgenieDriver.deliver(
      { apiKey: "k1" },
      makePayload({ pipeline: "logs-pipeline", node: "n1", team: "obs" }),
    );

    expect(result.success).toBe(true);
    expect(captured.url).toBe(US_URL);
    expect((captured.init?.headers as Record<string, string> | undefined)?.Authorization).toBe("GenieKey k1");
    expect(validateOutboundUrlMock).toHaveBeenCalledWith(US_URL, { force: true });

    const body = parsedBody();
    expect(body.message).toContain("High CPU");
    expect(body.alias).toBe("vectorflow-a1");
    expect(body.priority).toBe("P3"); // warning -> P3
    const tags = body.tags as string[];
    expect(tags).toContain("vectorflow");
    expect(tags).toContain("severity:warning");
    expect(tags).toContain("env:prod");
    expect(tags).toContain("metric:cpu_usage");
    expect(tags).toContain("pipeline:logs-pipeline");
    expect(tags).toContain("team:obs");
  });

  it("routes to the EU endpoint when region is 'eu'", async () => {
    await opsgenieDriver.deliver({ apiKey: "k1", region: "eu" }, makePayload());

    expect(captured.url).toBe(EU_URL);
    expect(validateOutboundUrlMock).toHaveBeenCalledWith(EU_URL, { force: true });
  });

  it("falls back to the US endpoint for an unrecognized region", async () => {
    await opsgenieDriver.deliver({ apiKey: "k1", region: "apac" }, makePayload());
    expect(captured.url).toBe(US_URL);
  });

  it.each([
    ["critical", "P1"],
    ["error", "P2"],
    ["high", "P2"],
    ["warning", "P3"],
    ["info", "P5"],
    ["unknown-sev", "P3"], // default fallback
  ])("maps severity %s -> priority %s", async (severity, priority) => {
    await opsgenieDriver.deliver({ apiKey: "k1" }, makePayload({ severity }));
    expect(parsedBody().priority).toBe(priority);
  });

  it("lets config.priorityMap override the default mapping", async () => {
    await opsgenieDriver.deliver(
      { apiKey: "k1", priorityMap: { warning: "P2" } },
      makePayload({ severity: "warning" }),
    );
    expect(parsedBody().priority).toBe("P2");
  });

  it("derives a stable dedup alias from the alertId", async () => {
    await opsgenieDriver.deliver({ apiKey: "k1" }, makePayload({ alertId: "alert-42" }));
    expect(parsedBody().alias).toBe("vectorflow-alert-42");
  });

  it("closes the correlated alert by alias when the status is resolved", async () => {
    const result = await opsgenieDriver.deliver(
      { apiKey: "k1" },
      makePayload({ status: "resolved", alertId: "a9" }),
    );

    expect(result.success).toBe(true);
    expect(captured.url).toBe(
      `${US_URL}/vectorflow-a9/close?identifierType=alias`,
    );
    expect((captured.init?.headers as Record<string, string> | undefined)?.Authorization).toBe("GenieKey k1");
  });

  it("returns failure when apiKey is missing (no fetch attempted)", async () => {
    const result = await opsgenieDriver.deliver({}, makePayload());
    expect(result.success).toBe(false);
    expect(result.error).toContain("apiKey");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns failure on a non-2xx response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "invalid priority",
    } as Response);

    const result = await opsgenieDriver.deliver({ apiKey: "k1" }, makePayload());
    expect(result.success).toBe(false);
    expect(result.error).toContain("422");
    expect(result.error).toContain("invalid priority");
  });

  it("returns failure when fetch rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const result = await opsgenieDriver.deliver({ apiKey: "k1" }, makePayload());
    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNRESET");
  });

  it("returns failure when the outbound URL is rejected (SSRF guard), without fetching", async () => {
    validateOutboundUrlMock.mockRejectedValue(new Error("blocked: resolves to private IP"));
    const result = await opsgenieDriver.deliver({ apiKey: "k1" }, makePayload());
    expect(result.success).toBe(false);
    expect(result.error).toContain("blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("opsgenieDriver.test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateOutboundUrlMock.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true, status: 202, text: async () => "" } as Response);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pages a test alert and then closes it (create + close)", async () => {
    const result = await opsgenieDriver.test({ apiKey: "k1" });
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
