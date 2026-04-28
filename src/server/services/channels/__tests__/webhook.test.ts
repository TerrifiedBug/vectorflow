import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/services/url-validation", () => ({
  validatePublicUrl: vi.fn().mockResolvedValue(undefined),
}));

import {
  formatWebhookMessage,
  webhookDriver,
} from "@/server/services/channels/webhook";
import type { ChannelPayload } from "@/server/services/channels/types";
import * as urlValidation from "@/server/services/url-validation";

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(urlValidation.validatePublicUrl).mockResolvedValue(undefined);
  });

  it("delivers successfully when the destination returns 2xx", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", mockFetch);

    const result = await webhookDriver.deliver(
      { url: "https://hooks.example.com/webhook" },
      makePayload(),
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.example.com/webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("returns failure when the destination responds with an error status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await webhookDriver.deliver(
      { url: "https://hooks.example.com/webhook" },
      makePayload(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");

    vi.unstubAllGlobals();
  });

  it("adds an HMAC signature when hmacSecret is configured", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", mockFetch);

    await webhookDriver.deliver(
      { url: "https://hooks.example.com/webhook", hmacSecret: "my-secret" },
      makePayload(),
    );

    const sentHeaders = mockFetch.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(sentHeaders["X-VectorFlow-Signature"]).toBeDefined();
    expect(sentHeaders["X-VectorFlow-Signature"]).toMatch(/^sha256=/);

    vi.unstubAllGlobals();
  });

  it("forwards custom headers from the channel config", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", mockFetch);

    await webhookDriver.deliver(
      {
        url: "https://hooks.example.com/webhook",
        headers: { Authorization: "Bearer token123" },
      },
      makePayload(),
    );

    const sentHeaders = mockFetch.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(sentHeaders["Authorization"]).toBe("Bearer token123");

    vi.unstubAllGlobals();
  });

  it("returns failure when URL validation rejects (SSRF protection)", async () => {
    vi.mocked(urlValidation.validatePublicUrl).mockRejectedValueOnce(
      new Error("Private IP address"),
    );

    const result = await webhookDriver.deliver(
      { url: "http://192.168.1.1/webhook" },
      makePayload(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Private IP");
  });

  it("returns failure when fetch throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await webhookDriver.deliver(
      { url: "https://hooks.example.com/webhook" },
      makePayload(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");

    vi.unstubAllGlobals();
  });

  it("returns failure when url is missing from config", async () => {
    const result = await webhookDriver.deliver({}, makePayload());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing url");
  });
});
