import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/services/webhook-hardened-delivery", () => ({
  fetchHardened: vi.fn(),
}));

import { teamsDriver } from "@/server/services/channels/teams";
import type { ChannelPayload } from "@/server/services/channels/types";
import * as hardened from "@/server/services/webhook-hardened-delivery";

const URL = "https://contoso.webhook.office.com/webhookb2/abc-123";

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

interface CapturedRequest {
  url?: string;
  body?: string;
}

describe("teamsDriver.deliver", () => {
  const fetchHardened = vi.mocked(hardened.fetchHardened);

  beforeEach(() => {
    vi.clearAllMocks();
    fetchHardened.mockResolvedValue({ status: 200, ok: true, redirectChain: [] });
  });

  it("posts a MessageCard to the configured webhook URL", async () => {
    const captured: CapturedRequest = {};
    fetchHardened.mockImplementation(async (url, opts) => {
      captured.url = url as string;
      captured.body = (opts as { body?: string }).body;
      return { status: 200, ok: true, redirectChain: [] };
    });

    const result = await teamsDriver.deliver(
      { webhookUrl: URL },
      makePayload({ pipeline: "logs-pipeline", suggestedAction: "Add a filter transform" }),
    );

    expect(result.success).toBe(true);
    expect(captured.url).toBe(URL);

    const body = JSON.parse(captured.body ?? "{}");
    expect(body["@type"]).toBe("MessageCard");
    expect(body.summary).toContain("High CPU");
    expect(body.themeColor).toBe("D7263D"); // firing -> red
    const factNames = body.sections[0].facts.map((f: { name: string }) => f.name);
    expect(factNames).toContain("Pipeline");
    expect(factNames).toContain("Suggested action");
    // dashboard deep-link surfaced as an OpenUri action
    expect(body.potentialAction[0].targets[0].uri).toBe("https://app.example.com/alerts");
  });

  it("uses the resolved theme color for resolved alerts", async () => {
    const captured: CapturedRequest = {};
    fetchHardened.mockImplementation(async (_url, opts) => {
      captured.body = (opts as { body?: string }).body;
      return { status: 200, ok: true, redirectChain: [] };
    });

    await teamsDriver.deliver({ webhookUrl: URL }, makePayload({ status: "resolved" }));

    const body = JSON.parse(captured.body ?? "{}");
    expect(body.themeColor).toBe("2EB67D"); // resolved -> green
  });

  it("returns failure when webhookUrl is missing (no fetch attempted)", async () => {
    const result = await teamsDriver.deliver({}, makePayload());
    expect(result.success).toBe(false);
    expect(result.error).toContain("webhookUrl");
    expect(fetchHardened).not.toHaveBeenCalled();
  });

  it("returns failure on a non-2xx response", async () => {
    fetchHardened.mockResolvedValue({ status: 502, ok: false, redirectChain: [] });
    const result = await teamsDriver.deliver({ webhookUrl: URL }, makePayload());
    expect(result.success).toBe(false);
    expect(result.error).toContain("502");
  });

  it("returns failure when the hardened fetch rejects (SSRF protection)", async () => {
    fetchHardened.mockRejectedValue(new Error("blocked: resolves to private IP"));
    const result = await teamsDriver.deliver({ webhookUrl: URL }, makePayload());
    expect(result.success).toBe(false);
    expect(result.error).toContain("blocked");
  });
});

describe("teamsDriver.test", () => {
  const fetchHardened = vi.mocked(hardened.fetchHardened);

  beforeEach(() => {
    vi.clearAllMocks();
    fetchHardened.mockResolvedValue({ status: 200, ok: true, redirectChain: [] });
  });

  it("delivers a sample card through the hardened fetch", async () => {
    const result = await teamsDriver.test({ webhookUrl: URL });
    expect(result.success).toBe(true);
    expect(fetchHardened).toHaveBeenCalledTimes(1);
  });
});
