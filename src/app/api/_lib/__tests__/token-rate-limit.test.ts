// src/app/api/_lib/__tests__/token-rate-limit.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { rateLimiter } from "@/app/api/v1/_lib/rate-limiter";
import { checkTokenRateLimit } from "../ip-rate-limit";

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost/api/agent/heartbeat", { headers });
}

describe("checkTokenRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when under the limit", async () => {
    const result = await checkTokenRateLimit(makeRequest("node-token-abc"), "heartbeat", 30);
    expect(result).toBeNull();
  });

  it("returns 429 response when limit exceeded", async () => {
    for (let i = 0; i < 30; i++) {
      await checkTokenRateLimit(makeRequest("node-token-xyz"), "heartbeat", 30);
    }
    const result = await checkTokenRateLimit(makeRequest("node-token-xyz"), "heartbeat", 30);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("includes Retry-After header on 429", async () => {
    for (let i = 0; i < 30; i++) {
      await checkTokenRateLimit(makeRequest("node-token-retry"), "heartbeat", 30);
    }
    const result = await checkTokenRateLimit(makeRequest("node-token-retry"), "heartbeat", 30);
    expect(result!.headers.get("Retry-After")).toBeTruthy();
  });

  it("isolates limits between different tokens", async () => {
    for (let i = 0; i < 30; i++) {
      await checkTokenRateLimit(makeRequest("token-a"), "heartbeat", 30);
    }
    expect(await checkTokenRateLimit(makeRequest("token-a"), "heartbeat", 30)).not.toBeNull();
    expect(await checkTokenRateLimit(makeRequest("token-b"), "heartbeat", 30)).toBeNull();
  });

  it("hashes bearer tokens before using them as rate-limit keys", async () => {
    const spy = vi.spyOn(rateLimiter, "checkKey");
    const rawToken = "vf_agent_secret_token";

    await checkTokenRateLimit(makeRequest(rawToken), "heartbeat", 30);

    const [key] = spy.mock.calls[0] as [string, number];
    const expectedHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    expect(key).toBe(`token:heartbeat:${expectedHash}`);
    expect(key).not.toContain(rawToken);
  });

  it("isolates limits between different endpoints for the same token", async () => {
    for (let i = 0; i < 30; i++) {
      await checkTokenRateLimit(makeRequest("token-shared"), "heartbeat", 30);
    }
    expect(await checkTokenRateLimit(makeRequest("token-shared"), "heartbeat", 30)).not.toBeNull();
    expect(await checkTokenRateLimit(makeRequest("token-shared"), "config", 30)).toBeNull();
  });

  it("returns 401 when no Authorization header is present", async () => {
    const result = await checkTokenRateLimit(makeRequest(), "heartbeat", 30);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns 401 when Authorization header is not Bearer format", async () => {
    const req = new Request("http://localhost/api/agent/heartbeat", {
      headers: { authorization: "Basic abc123" },
    });
    const result = await checkTokenRateLimit(req, "heartbeat", 30);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("resets after window expires", async () => {
    for (let i = 0; i < 30; i++) {
      await checkTokenRateLimit(makeRequest("token-reset"), "heartbeat", 30);
    }
    expect(await checkTokenRateLimit(makeRequest("token-reset"), "heartbeat", 30)).not.toBeNull();

    vi.advanceTimersByTime(61_000);

    expect(await checkTokenRateLimit(makeRequest("token-reset"), "heartbeat", 30)).toBeNull();
  });

  it("allows normal 15s polling cadence (4 req/min) without throttling", async () => {
    // Simulate 4 requests per minute (one every 15 seconds) — typical agent polling
    for (let i = 0; i < 4; i++) {
      const result = await checkTokenRateLimit(makeRequest("token-polling"), "config", 30);
      expect(result).toBeNull();
      vi.advanceTimersByTime(15_000);
    }
  });
});
