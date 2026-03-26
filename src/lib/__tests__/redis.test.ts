import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock ioredis before importing the module under test.
// We need a constructor-compatible mock (class) so `new Redis(...)` works.
// ---------------------------------------------------------------------------
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();

let mockStatus = "wait";

// Use a proper class so `new Redis(...)` works
class MockRedisClass {
  connect = mockConnect;
  on = mockOn;
  get status() {
    return mockStatus;
  }
}

vi.mock("ioredis", () => {
  return { default: MockRedisClass, __esModule: true };
});

// ---------------------------------------------------------------------------
// Reset module-level singletons between tests by clearing the globalThis cache
// ---------------------------------------------------------------------------
function resetRedisModule() {
  const g = globalThis as unknown as { redis: unknown };
  delete g.redis;
}

// Dynamic import helper
async function importRedis() {
  const mod = await import("../redis");
  return mod;
}

describe("redis client module", () => {
  const originalEnv = process.env.REDIS_URL;

  beforeEach(() => {
    resetRedisModule();
    vi.clearAllMocks();
    mockStatus = "wait";
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.REDIS_URL = originalEnv;
    } else {
      delete process.env.REDIS_URL;
    }
  });

  // -----------------------------------------------------------------------
  // redactRedisUrl
  // -----------------------------------------------------------------------
  describe("redactRedisUrl", () => {
    it("redacts password from redis://:secret@host:6379", async () => {
      const { redactRedisUrl } = await importRedis();
      const result = redactRedisUrl("redis://:secret@host:6379");
      expect(result).toContain("***");
      expect(result).not.toContain("secret");
      expect(result).toContain("host:6379");
    });

    it("redacts password from redis://user:pass@host:6379/0", async () => {
      const { redactRedisUrl } = await importRedis();
      const result = redactRedisUrl("redis://user:pass@host:6379/0");
      expect(result).toContain("***");
      expect(result).not.toContain("pass");
      expect(result).toContain("user");
    });

    it("handles URL without password", async () => {
      const { redactRedisUrl } = await importRedis();
      const result = redactRedisUrl("redis://host:6379");
      // URL.toString() may add a trailing slash — either form is valid
      expect(result).toContain("redis://host:6379");
      expect(result).not.toContain("***");
    });

    it("handles invalid URL gracefully", async () => {
      const { redactRedisUrl } = await importRedis();
      const result = redactRedisUrl("not-a-url");
      expect(result).toContain("***");
      expect(result).not.toContain("not-a-url");
    });
  });

  // -----------------------------------------------------------------------
  // getRedis
  // -----------------------------------------------------------------------
  describe("getRedis", () => {
    it("returns null when REDIS_URL is not set", async () => {
      delete process.env.REDIS_URL;
      const { getRedis } = await importRedis();
      expect(getRedis()).toBeNull();
    });

    it("returns null when REDIS_URL is empty string", async () => {
      process.env.REDIS_URL = "";
      const { getRedis } = await importRedis();
      expect(getRedis()).toBeNull();
    });

    it("returns an ioredis instance when REDIS_URL is set", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      const { getRedis } = await importRedis();
      const client = getRedis();
      expect(client).not.toBeNull();
      expect(client).toBeInstanceOf(MockRedisClass);
      expect(mockConnect).toHaveBeenCalled();
    });

    it("returns the same instance on subsequent calls (singleton)", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      const { getRedis } = await importRedis();
      const first = getRedis();
      const second = getRedis();
      expect(first).toBe(second);
    });

    it("registers connect, error, and close event listeners", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      const { getRedis } = await importRedis();
      getRedis();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eventNames = mockOn.mock.calls.map((call: any[]) => call[0]);
      expect(eventNames).toContain("connect");
      expect(eventNames).toContain("error");
      expect(eventNames).toContain("close");
    });
  });

  // -----------------------------------------------------------------------
  // isRedisAvailable
  // -----------------------------------------------------------------------
  describe("isRedisAvailable", () => {
    it("returns false when no Redis configured", async () => {
      delete process.env.REDIS_URL;
      const { isRedisAvailable } = await importRedis();
      expect(isRedisAvailable()).toBe(false);
    });

    it("returns false when Redis client status is not ready", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      mockStatus = "connecting";
      const { isRedisAvailable } = await importRedis();
      expect(isRedisAvailable()).toBe(false);
    });

    it("returns true when Redis client status is ready", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      mockStatus = "ready";
      const { isRedisAvailable } = await importRedis();
      expect(isRedisAvailable()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Negative / edge-case tests
  // -----------------------------------------------------------------------
  describe("negative tests", () => {
    it("connect() rejection is swallowed (doesn't crash)", async () => {
      mockConnect.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      process.env.REDIS_URL = "redis://localhost:6379";
      const { getRedis } = await importRedis();

      // Should not throw — the catch in the module handles it
      expect(() => getRedis()).not.toThrow();
    });

    it("Redis unreachable: isRedisAvailable returns false, getRedis still returns client", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      mockStatus = "reconnecting";
      const { getRedis, isRedisAvailable } = await importRedis();
      const client = getRedis();
      expect(client).not.toBeNull();
      expect(isRedisAvailable()).toBe(false);
    });
  });
});
