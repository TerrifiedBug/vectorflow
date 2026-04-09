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
    delete process.env.VF_LOG_LEVEL;
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
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_DSN;
    delete process.env.REDIS_URL;
    delete process.env.CONTEXT7_API_KEY;
    delete process.env.ANALYZE;
  });

  afterEach(() => {
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
});
