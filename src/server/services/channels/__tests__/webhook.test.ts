import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/services/webhook-hardened-delivery", () => ({
  fetchHardened: vi.fn(),
}));

import {
  formatWebhookMessage,
  webhookDriver,
} from "@/server/services/channels/webhook";
import type { ChannelPayload } from "@/server/services/channels/types";
import * as hardened from "@/server/services/webhook-hardened-delivery";

function makePayload(overrides: Partial<ChannelPayload> = {}): ChannelPayload {
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

describe("formatWebhookMessage", () => {
  it("formats a firing alert with all fields", () => {
    const message = formatWebhookMessage(makePayload());

    expect(message).toContain("FIRING");
    expect(message).toContain("CPU High");
    expect(message).toContain("CPU usage is 92.50");
    expect(message).toContain("node-1.example.com");
    expect(message).toContain("Logs Pipeline");
    expect(message).toContain("Production");
    expect(message).toContain("Platform");
  });

  it("formats a resolved alert", () => {
    const message = formatWebhookMessage(makePayload({ status: "resolved" }));

    expect(message).toContain("RESOLVED");
    expect(message).not.toContain("FIRING");
  });

  it("omits optional fields when not provided", () => {
    const message = formatWebhookMessage(
      makePayload({ node: undefined, pipeline: undefined, team: undefined }),
    );

    expect(message).not.toContain("**Node:**");
    expect(message).not.toContain("**Pipeline:**");
    expect(message).not.toContain("**Team:**");
  });
});

describe("webhookDriver.deliver", () => {
  const fetchHardened = vi.mocked(hardened.fetchHardened);

  beforeEach(() => {
    vi.clearAllMocks();
    fetchHardened.mockResolvedValue({ status: 200, ok: true, redirectChain: [] });
  });

  it("delivers through the hardened fetch when the destination returns 2xx", async () => {
    const result = await webhookDriver.deliver(
      { url: "https://hooks.example.com/webhook" },
      makePayload(),
    );

    expect(result.success).toBe(true);
    expect(fetchHardened).toHaveBeenCalledWith(
      "https://hooks.example.com/webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("returns failure when the destination responds with an error status", async () => {
    fetchHardened.mockResolvedValue({ status: 500, ok: false, redirectChain: [] });

    const result = await webhookDriver.deliver(
      { url: "https://hooks.example.com/webhook" },
      makePayload(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });

  it("adds an HMAC signature when hmacSecret is configured", async () => {
    await webhookDriver.deliver(
      { url: "https://hooks.example.com/webhook", hmacSecret: "my-secret" },
      makePayload(),
    );

    const sentHeaders = fetchHardened.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(sentHeaders["X-VectorFlow-Signature"]).toBeDefined();
    expect(sentHeaders["X-VectorFlow-Signature"]).toMatch(/^sha256=/);
  });

  it("forwards custom headers from the channel config", async () => {
    await webhookDriver.deliver(
      {
        url: "https://hooks.example.com/webhook",
        headers: { Authorization: "Bearer token123" },
      },
      makePayload(),
    );

    const sentHeaders = fetchHardened.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(sentHeaders["Authorization"]).toBe("Bearer token123");
  });

  it("returns failure when the hardened fetch rejects the URL (SSRF protection)", async () => {
    fetchHardened.mockRejectedValueOnce(new Error("Private IP address"));

    const result = await webhookDriver.deliver(
      { url: "http://192.168.1.1/webhook" },
      makePayload(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Private IP");
  });

  it("returns failure when a redirect to a private IP is refused mid-delivery", async () => {
    // fetchHardened re-validates every redirect hop and throws on a 3xx
    // into a private/reserved address (e.g. cloud metadata). The driver
    // must surface that as a failed delivery, never a silent success.
    fetchHardened.mockRejectedValueOnce(
      new Error("Refusing redirect to private IP (169.254.169.254)"),
    );

    const result = await webhookDriver.deliver(
      { url: "https://hooks.example.com/webhook" },
      makePayload(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("169.254.169.254");
  });

  it("returns failure when the hardened fetch throws", async () => {
    fetchHardened.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await webhookDriver.deliver(
      { url: "https://hooks.example.com/webhook" },
      makePayload(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });

  it("returns failure when url is missing from config", async () => {
    const result = await webhookDriver.deliver({}, makePayload());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing url");
  });
});
