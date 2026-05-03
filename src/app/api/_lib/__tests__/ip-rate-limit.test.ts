import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkIpRateLimit } from "../ip-rate-limit";

function makeRequest(
  ip?: string,
  headers?: Record<string, string>,
): Request {
  const h: Record<string, string> = { ...headers };
  if (ip) h["x-forwarded-for"] = ip.includes(",") ? ip : `${ip}, 10.0.0.10`;
  return new Request("http://localhost/api/test", { headers: h });
}

describe("checkIpRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("VF_TRUSTED_PROXIES", "10.0.0.10");
    vi.advanceTimersByTime(61_000);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("returns null when under the limit", async () => {
    const result = await checkIpRateLimit(makeRequest("1.2.3.4"), "enroll", 10);
    expect(result).toBeNull();
  });

  it("returns 429 response when limit exceeded", async () => {
    for (let i = 0; i < 10; i++) {
      await checkIpRateLimit(makeRequest("5.6.7.8"), "enroll", 10);
    }
    const result = await checkIpRateLimit(makeRequest("5.6.7.8"), "enroll", 10);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("includes Retry-After header on 429", async () => {
    for (let i = 0; i < 5; i++) {
      await checkIpRateLimit(makeRequest("9.0.1.2"), "setup", 5);
    }
    const result = await checkIpRateLimit(makeRequest("9.0.1.2"), "setup", 5);
    expect(result!.headers.get("Retry-After")).toBeTruthy();
  });

  it("isolates limits between different IPs", async () => {
    for (let i = 0; i < 10; i++) {
      await checkIpRateLimit(makeRequest("10.0.0.1"), "enroll", 10);
    }
    expect(await checkIpRateLimit(makeRequest("10.0.0.1"), "enroll", 10)).not.toBeNull();
    expect(await checkIpRateLimit(makeRequest("10.0.0.2"), "enroll", 10)).toBeNull();
  });

  it("ignores forwarded IP headers unless trusted proxies are configured", async () => {
    vi.stubEnv("VF_TRUSTED_PROXIES", "");
    const req = makeRequest("203.0.113.50");
    for (let i = 0; i < 10; i++) {
      await checkIpRateLimit(req, "untrusted-enroll", 10);
    }

    expect(await checkIpRateLimit(makeRequest("203.0.113.50"), "untrusted-enroll-other", 10)).toBeNull();
    expect(await checkIpRateLimit(new Request("http://localhost/api/test"), "untrusted-enroll", 10)).not.toBeNull();
  });

  it("extracts the client IP from x-forwarded-for only behind a trusted proxy", async () => {
    vi.stubEnv("VF_TRUSTED_PROXIES", "10.0.0.10");
    const req = makeRequest(undefined, {
      "x-forwarded-for": "203.0.113.50, 10.0.0.10",
    });
    for (let i = 0; i < 10; i++) {
      await checkIpRateLimit(req, "enroll", 10);
    }
    const blocked = await checkIpRateLimit(
      makeRequest("203.0.113.50, 10.0.0.10"),
      "enroll",
      10,
    );
    expect(blocked).not.toBeNull();
  });

  it("ignores spoofed x-forwarded-for chains that do not end at a trusted proxy", async () => {
    vi.stubEnv("VF_TRUSTED_PROXIES", "10.0.0.10");
    const req = makeRequest(undefined, {
      "x-forwarded-for": "203.0.113.50, 198.51.100.7",
    });
    for (let i = 0; i < 5; i++) {
      await checkIpRateLimit(req, "setup", 5);
    }
    const result = await checkIpRateLimit(
      makeRequest("203.0.113.50, 10.0.0.10"),
      "setup",
      5,
    );
    expect(result).toBeNull();
    expect(await checkIpRateLimit(new Request("http://localhost/api/test"), "setup", 5)).not.toBeNull();
  });

  it("supports trusted proxy CIDR ranges", async () => {
    vi.stubEnv("VF_TRUSTED_PROXIES", "10.0.0.0/24");
    const req = makeRequest("192.0.2.55, 10.0.0.42");
    for (let i = 0; i < 5; i++) {
      await checkIpRateLimit(req, "setup", 5);
    }
    const result = await checkIpRateLimit(req, "setup", 5);
    expect(result).not.toBeNull();
  });

  it("uses 'unknown' key when no IP headers present", async () => {
    const req = new Request("http://localhost/api/test");
    const result = await checkIpRateLimit(req, "enroll", 10);
    expect(result).toBeNull();
  });

  it("resets after window expires", async () => {
    for (let i = 0; i < 10; i++) {
      await checkIpRateLimit(makeRequest("1.1.1.1"), "enroll", 10);
    }
    expect(await checkIpRateLimit(makeRequest("1.1.1.1"), "enroll", 10)).not.toBeNull();

    vi.advanceTimersByTime(61_000);

    expect(await checkIpRateLimit(makeRequest("1.1.1.1"), "enroll", 10)).toBeNull();
  });

  it("supports single-hop X-Forwarded-For chains", async () => {
    vi.stubEnv("VF_TRUSTED_PROXIES", "10.0.0.10");
    const req = makeRequest(undefined, { "x-forwarded-for": "192.0.2.99" });
    for (let i = 0; i < 5; i++) {
      await checkIpRateLimit(req, "single-hop", 5);
    }
    const blocked = await checkIpRateLimit(req, "single-hop", 5);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);

    const otherReq = makeRequest(undefined, { "x-forwarded-for": "192.0.2.100" });
    expect(await checkIpRateLimit(otherReq, "single-hop", 5)).toBeNull();
  });

  it("falls back to legacy VF_TRUST_PROXY_HEADERS behavior", async () => {
    vi.stubEnv("VF_TRUSTED_PROXIES", "");
    vi.stubEnv("VF_TRUST_PROXY_HEADERS", "true");
    const req = makeRequest(undefined, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    for (let i = 0; i < 5; i++) {
      await checkIpRateLimit(req, "legacy-endpoint", 5);
    }
    const blocked = await checkIpRateLimit(req, "legacy-endpoint", 5);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);

    const otherReq = makeRequest(undefined, { "x-forwarded-for": "203.0.113.8, 10.0.0.1" });
    expect(await checkIpRateLimit(otherReq, "legacy-endpoint", 5)).toBeNull();
  });
});
