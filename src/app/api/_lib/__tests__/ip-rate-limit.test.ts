import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkIpRateLimit } from "../ip-rate-limit";

function makeRequest(
  ip?: string,
  headers?: Record<string, string>,
): Request {
  const h: Record<string, string> = { ...headers };
  if (ip) h["x-forwarded-for"] = ip;
  return new Request("http://localhost/api/test", { headers: h });
}

describe("checkIpRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when under the limit", () => {
    const result = checkIpRateLimit(makeRequest("1.2.3.4"), "enroll", 10);
    expect(result).toBeNull();
  });

  it("returns 429 response when limit exceeded", () => {
    for (let i = 0; i < 10; i++) {
      checkIpRateLimit(makeRequest("5.6.7.8"), "enroll", 10);
    }
    const result = checkIpRateLimit(makeRequest("5.6.7.8"), "enroll", 10);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("includes Retry-After header on 429", () => {
    for (let i = 0; i < 5; i++) {
      checkIpRateLimit(makeRequest("9.0.1.2"), "setup", 5);
    }
    const result = checkIpRateLimit(makeRequest("9.0.1.2"), "setup", 5);
    expect(result!.headers.get("Retry-After")).toBeTruthy();
  });

  it("isolates limits between different IPs", () => {
    for (let i = 0; i < 10; i++) {
      checkIpRateLimit(makeRequest("10.0.0.1"), "enroll", 10);
    }
    expect(checkIpRateLimit(makeRequest("10.0.0.1"), "enroll", 10)).not.toBeNull();
    expect(checkIpRateLimit(makeRequest("10.0.0.2"), "enroll", 10)).toBeNull();
  });

  it("extracts IP from x-forwarded-for (rightmost entry)", () => {
    const req = makeRequest(undefined, {
      "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178",
    });
    for (let i = 0; i < 10; i++) {
      checkIpRateLimit(req, "enroll", 10);
    }
    // Rightmost entry is the proxy-appended IP
    const blocked = checkIpRateLimit(
      makeRequest("150.172.238.178"),
      "enroll",
      10,
    );
    expect(blocked).not.toBeNull();
  });

  it("falls back to x-real-ip when x-forwarded-for missing", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-real-ip": "192.168.1.1" },
    });
    for (let i = 0; i < 5; i++) {
      checkIpRateLimit(req, "setup", 5);
    }
    const result = checkIpRateLimit(req, "setup", 5);
    expect(result).not.toBeNull();
  });

  it("uses 'unknown' key when no IP headers present", () => {
    const req = new Request("http://localhost/api/test");
    const result = checkIpRateLimit(req, "enroll", 10);
    expect(result).toBeNull();
  });

  it("resets after window expires", () => {
    for (let i = 0; i < 10; i++) {
      checkIpRateLimit(makeRequest("1.1.1.1"), "enroll", 10);
    }
    expect(checkIpRateLimit(makeRequest("1.1.1.1"), "enroll", 10)).not.toBeNull();

    vi.advanceTimersByTime(61_000);

    expect(checkIpRateLimit(makeRequest("1.1.1.1"), "enroll", 10)).toBeNull();
  });
});
