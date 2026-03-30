// src/app/api/_lib/__tests__/token-rate-limit.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  it("returns null when under the limit", () => {
    const result = checkTokenRateLimit(makeRequest("node-token-abc"), "heartbeat", 30);
    expect(result).toBeNull();
  });

  it("returns 429 response when limit exceeded", () => {
    for (let i = 0; i < 30; i++) {
      checkTokenRateLimit(makeRequest("node-token-xyz"), "heartbeat", 30);
    }
    const result = checkTokenRateLimit(makeRequest("node-token-xyz"), "heartbeat", 30);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("includes Retry-After header on 429", () => {
    for (let i = 0; i < 30; i++) {
      checkTokenRateLimit(makeRequest("node-token-retry"), "heartbeat", 30);
    }
    const result = checkTokenRateLimit(makeRequest("node-token-retry"), "heartbeat", 30);
    expect(result!.headers.get("Retry-After")).toBeTruthy();
  });

  it("isolates limits between different tokens", () => {
    for (let i = 0; i < 30; i++) {
      checkTokenRateLimit(makeRequest("token-a"), "heartbeat", 30);
    }
    expect(checkTokenRateLimit(makeRequest("token-a"), "heartbeat", 30)).not.toBeNull();
    expect(checkTokenRateLimit(makeRequest("token-b"), "heartbeat", 30)).toBeNull();
  });

  it("isolates limits between different endpoints for the same token", () => {
    for (let i = 0; i < 30; i++) {
      checkTokenRateLimit(makeRequest("token-shared"), "heartbeat", 30);
    }
    expect(checkTokenRateLimit(makeRequest("token-shared"), "heartbeat", 30)).not.toBeNull();
    expect(checkTokenRateLimit(makeRequest("token-shared"), "config", 30)).toBeNull();
  });

  it("returns 401 when no Authorization header is present", () => {
    const result = checkTokenRateLimit(makeRequest(), "heartbeat", 30);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns 401 when Authorization header is not Bearer format", () => {
    const req = new Request("http://localhost/api/agent/heartbeat", {
      headers: { authorization: "Basic abc123" },
    });
    const result = checkTokenRateLimit(req, "heartbeat", 30);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("resets after window expires", () => {
    for (let i = 0; i < 30; i++) {
      checkTokenRateLimit(makeRequest("token-reset"), "heartbeat", 30);
    }
    expect(checkTokenRateLimit(makeRequest("token-reset"), "heartbeat", 30)).not.toBeNull();

    vi.advanceTimersByTime(61_000);

    expect(checkTokenRateLimit(makeRequest("token-reset"), "heartbeat", 30)).toBeNull();
  });

  it("allows normal 15s polling cadence (4 req/min) without throttling", () => {
    // Simulate 4 requests per minute (one every 15 seconds) — typical agent polling
    for (let i = 0; i < 4; i++) {
      const result = checkTokenRateLimit(makeRequest("token-polling"), "config", 30);
      expect(result).toBeNull();
      vi.advanceTimersByTime(15_000);
    }
  });
});
