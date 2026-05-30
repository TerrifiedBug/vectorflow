import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalEnv = { ...process.env };

function setRequiredEnv() {
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/vf";
  process.env.NEXTAUTH_SECRET = "test-secret-at-least-16-chars-long";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
}

describe("env validation", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_URL;
    delete process.env.AUTH_TRUST_HOST;
    delete process.env.VF_LOG_LEVEL;
    delete process.env.LOG_LEVEL;
    delete process.env.DATABASE_POOL_MAX;
    delete process.env.DATABASE_CONNECTION_TIMEOUT_MS;
    delete process.env.DATABASE_IDLE_TIMEOUT_MS;
    delete process.env.VF_BACKUP_DIR;
    delete process.env.VF_VECTOR_BIN;
    delete process.env.VF_AUDIT_LOG_PATH;
    delete process.env.VF_VERSION;
    delete process.env.METRICS_CHUNK_INTERVAL;
    delete process.env.METRICS_COMPRESS_AFTER;
    delete process.env.VF_DISABLE_LOCAL_AUTH;
    delete process.env.TIMESCALEDB_ENABLED;
    delete process.env.VF_ENCRYPTION_KEY_V2;
    delete process.env.VF_ALLOW_NEXTAUTH_DERIVED_KEY;
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_DSN;
    delete process.env.REDIS_URL;
    delete process.env.CONTEXT7_API_KEY;
    delete process.env.ANALYZE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
  });

  it("throws when DATABASE_URL is missing", async () => {
    process.env.NEXTAUTH_SECRET = "test-secret-at-least-16-chars-long";
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    await expect(import("@/lib/env")).rejects.toThrow();
  });

  it("throws when NEXTAUTH_SECRET is missing", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/vf";
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    await expect(import("@/lib/env")).rejects.toThrow();
  });

  it("throws when NEXTAUTH_SECRET is too short", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/vf";
    process.env.NEXTAUTH_SECRET = "short";
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    await expect(import("@/lib/env")).rejects.toThrow();
  });

  it("parses valid env with all required vars", async () => {
    setRequiredEnv();
    const { env } = await import("@/lib/env");
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/vf");
    expect(env.NEXTAUTH_SECRET).toBe("test-secret-at-least-16-chars-long");
    expect(env.NEXTAUTH_URL).toBe("http://localhost:3000");
  });

  it("allows NEXTAUTH_URL to be omitted when AUTH_TRUST_HOST is enabled", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/vf";
    process.env.NEXTAUTH_SECRET = "test-secret-at-least-16-chars-long";
    process.env.AUTH_TRUST_HOST = "true";

    const { env } = await import("@/lib/env");

    expect(env.NEXTAUTH_URL).toBeUndefined();
  });

  it("applies defaults for optional vars", async () => {
    setRequiredEnv();
    const { env } = await import("@/lib/env");
    expect(env.VF_LOG_LEVEL).toBe("info");
    expect(env.DATABASE_POOL_MAX).toBe(50);
    expect(env.DATABASE_CONNECTION_TIMEOUT_MS).toBe(5000);
    expect(env.DATABASE_IDLE_TIMEOUT_MS).toBe(30000);
    expect(env.VF_BACKUP_DIR).toBe("/backups");
    expect(env.VF_VECTOR_BIN).toBe("vector");
    expect(env.VF_VERSION).toBe("dev");
    expect(env.METRICS_CHUNK_INTERVAL).toBe("1 day");
    expect(env.METRICS_COMPRESS_AFTER).toBe("24 hours");
  });

  it("falls back to LOG_LEVEL when VF_LOG_LEVEL is unset", async () => {
    setRequiredEnv();
    process.env.LOG_LEVEL = "debug";
    const { env } = await import("@/lib/env");
    expect(env.VF_LOG_LEVEL).toBe("debug");
  });

  it("prefers VF_LOG_LEVEL over LOG_LEVEL when both are set", async () => {
    setRequiredEnv();
    process.env.LOG_LEVEL = "debug";
    process.env.VF_LOG_LEVEL = "warn";
    const { env } = await import("@/lib/env");
    expect(env.VF_LOG_LEVEL).toBe("warn");
  });

  it("rejects invalid legacy LOG_LEVEL values", async () => {
    setRequiredEnv();
    process.env.LOG_LEVEL = "verbose";
    await expect(import("@/lib/env")).rejects.toThrow();
  });

  it("coerces numeric strings to numbers", async () => {
    setRequiredEnv();
    process.env.DATABASE_POOL_MAX = "25";
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = "10000";
    const { env } = await import("@/lib/env");
    expect(env.DATABASE_POOL_MAX).toBe(25);
    expect(env.DATABASE_CONNECTION_TIMEOUT_MS).toBe(10000);
  });

  it("parses boolean feature flags", async () => {
    setRequiredEnv();
    process.env.VF_DISABLE_LOCAL_AUTH = "true";
    process.env.TIMESCALEDB_ENABLED = "false";
    const { env } = await import("@/lib/env");
    expect(env.VF_DISABLE_LOCAL_AUTH).toBe("true");
    expect(env.TIMESCALEDB_ENABLED).toBe("false");
  });

  it("allows optional vars to be undefined", async () => {
    setRequiredEnv();
    const { env } = await import("@/lib/env");
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.VF_ENCRYPTION_KEY_V2).toBeUndefined();
  });

  describe("placeholder-secret boot guard (production)", () => {
    it("rejects the published NEXTAUTH_SECRET placeholder in production", async () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/vf";
      process.env.NEXTAUTH_SECRET = "change-me-to-a-random-32-char-string";
      process.env.NEXTAUTH_URL = "https://vf.example.com";
      vi.stubEnv("NODE_ENV", "production");
      await expect(import("@/lib/env")).rejects.toThrow(/NEXTAUTH_SECRET/);
    });

    it("rejects the published VF_ENCRYPTION_KEY_V2 placeholder in production", async () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/vf";
      process.env.NEXTAUTH_SECRET = "a-real-unique-secret-value-32-chars";
      process.env.NEXTAUTH_URL = "https://vf.example.com";
      process.env.VF_ENCRYPTION_KEY_V2 = "change-me-to-a-different-random-32-char-string";
      vi.stubEnv("NODE_ENV", "production");
      await expect(import("@/lib/env")).rejects.toThrow(/VF_ENCRYPTION_KEY_V2/);
    });

    it("matches the placeholder case-insensitively", async () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/vf";
      process.env.NEXTAUTH_SECRET = "Change-Me-To-A-Random-32-Char-String";
      process.env.NEXTAUTH_URL = "https://vf.example.com";
      vi.stubEnv("NODE_ENV", "production");
      await expect(import("@/lib/env")).rejects.toThrow(/NEXTAUTH_SECRET/);
    });

    it("allows the placeholder outside production (dev/test)", async () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/vf";
      process.env.NEXTAUTH_SECRET = "change-me-to-a-random-32-char-string";
      process.env.NEXTAUTH_URL = "http://localhost:3000";
      vi.stubEnv("NODE_ENV", "development");
      const { env } = await import("@/lib/env");
      expect(env.NEXTAUTH_SECRET).toBe("change-me-to-a-random-32-char-string");
    });

    it("accepts a unique NEXTAUTH_SECRET in production", async () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/vf";
      process.env.NEXTAUTH_SECRET = "a-real-unique-secret-value-32-chars";
      process.env.NEXTAUTH_URL = "https://vf.example.com";
      process.env.VF_ENCRYPTION_KEY_V2 = "a-dedicated-unique-encryption-key-32c";
      vi.stubEnv("NODE_ENV", "production");
      const { env } = await import("@/lib/env");
      expect(env.NEXTAUTH_SECRET).toBe("a-real-unique-secret-value-32-chars");
    });
  });

  describe("encryption-key boot guard (production)", () => {
    function setProdBase() {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/vf";
      process.env.NEXTAUTH_SECRET = "a-real-unique-secret-value-32-chars";
      process.env.NEXTAUTH_URL = "https://vf.example.com";
    }

    it("refuses to boot when VF_ENCRYPTION_KEY_V2 is unset in production", async () => {
      setProdBase();
      vi.stubEnv("NODE_ENV", "production");
      await expect(import("@/lib/env")).rejects.toThrow(/VF_ENCRYPTION_KEY_V2/);
    });

    it("boots when VF_ENCRYPTION_KEY_V2 is set in production", async () => {
      setProdBase();
      process.env.VF_ENCRYPTION_KEY_V2 = "a-dedicated-unique-encryption-key-32c";
      vi.stubEnv("NODE_ENV", "production");
      const { env } = await import("@/lib/env");
      expect(env.VF_ENCRYPTION_KEY_V2).toBe("a-dedicated-unique-encryption-key-32c");
    });

    it("boots when the operator explicitly accepts the NEXTAUTH_SECRET-derived key", async () => {
      setProdBase();
      process.env.VF_ALLOW_NEXTAUTH_DERIVED_KEY = "true";
      vi.stubEnv("NODE_ENV", "production");
      const { env } = await import("@/lib/env");
      expect(env.VF_ENCRYPTION_KEY_V2).toBeUndefined();
    });

    it("does not require VF_ENCRYPTION_KEY_V2 outside production", async () => {
      setProdBase();
      vi.stubEnv("NODE_ENV", "development");
      const { env } = await import("@/lib/env");
      expect(env.VF_ENCRYPTION_KEY_V2).toBeUndefined();
    });
  });
});
