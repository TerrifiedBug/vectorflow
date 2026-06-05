import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the ClickHouse driver so no real connection is ever attempted. The
// wrapper reads VF_LAKE_* from process.env at call time, so each test just sets
// process.env and resets the globalThis-cached singleton — no module reset.
const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@clickhouse/client", () => ({
  createClient: createClientMock,
}));

import {
  isLakeEnabled,
  isLakeColdTierEnabled,
  getLakeClient,
  getLakeConfig,
} from "../clickhouse";

const LAKE_ENV_KEYS = [
  "VF_LAKE_CLICKHOUSE_URL",
  "VF_LAKE_CLICKHOUSE_USER",
  "VF_LAKE_CLICKHOUSE_PASSWORD",
  "VF_LAKE_CLICKHOUSE_DATABASE",
  "VF_LAKE_S3_ENDPOINT",
  "VF_LAKE_S3_BUCKET",
  "VF_LAKE_S3_REGION",
  "VF_LAKE_S3_ACCESS_KEY_ID",
  "VF_LAKE_S3_SECRET_ACCESS_KEY",
] as const;

function clearLakeEnv(): void {
  for (const key of LAKE_ENV_KEYS) {
    delete process.env[key];
  }
}

describe("lake clickhouse wrapper", () => {
  beforeEach(() => {
    // Reset the globalThis-cached singleton + the driver mock.
    delete (globalThis as unknown as { __vfLakeClient?: unknown }).__vfLakeClient;
    createClientMock.mockReset();
    createClientMock.mockImplementation(() => ({
      query: vi.fn(),
      insert: vi.fn(),
      ping: vi.fn(),
      close: vi.fn(),
    }));
    clearLakeEnv();
  });

  afterEach(() => {
    // Avoid leaking VF_LAKE_* values into other suites sharing the worker.
    clearLakeEnv();
  });

  describe("when VF_LAKE_CLICKHOUSE_URL is unset (disabled)", () => {
    it("reports the lake as disabled", () => {
      expect(isLakeEnabled()).toBe(false);
    });

    it("treats an empty URL as disabled", () => {
      process.env.VF_LAKE_CLICKHOUSE_URL = "";
      expect(isLakeEnabled()).toBe(false);
    });

    it("getLakeClient() throws a clear error and never constructs a client", () => {
      expect(() => getLakeClient()).toThrow(
        "VectorFlow Lake is not configured (VF_LAKE_CLICKHOUSE_URL unset)",
      );
      expect(createClientMock).not.toHaveBeenCalled();
    });

    it("getLakeConfig() throws when disabled", () => {
      expect(() => getLakeConfig()).toThrow(/not configured/);
    });
  });

  describe("when configured", () => {
    beforeEach(() => {
      process.env.VF_LAKE_CLICKHOUSE_URL = "http://clickhouse:8123";
      process.env.VF_LAKE_CLICKHOUSE_USER = "lake_user";
      process.env.VF_LAKE_CLICKHOUSE_PASSWORD = "lake_pass";
      process.env.VF_LAKE_CLICKHOUSE_DATABASE = "vf_lake_test";
    });

    it("reports the lake as enabled", () => {
      expect(isLakeEnabled()).toBe(true);
    });

    it("constructs the client with the configured url and credentials", () => {
      getLakeClient();
      expect(createClientMock).toHaveBeenCalledTimes(1);
      expect(createClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "http://clickhouse:8123",
          username: "lake_user",
          password: "lake_pass",
          database: "vf_lake_test",
        }),
      );
    });

    it("caches the client across calls (singleton)", () => {
      const first = getLakeClient();
      const second = getLakeClient();
      expect(first).toBe(second);
      expect(createClientMock).toHaveBeenCalledTimes(1);
    });

    it("defaults the database to vectorflow_lake when unset", () => {
      delete process.env.VF_LAKE_CLICKHOUSE_DATABASE;
      expect(getLakeConfig().database).toBe("vectorflow_lake");
    });
  });

  describe("cold-tier detection", () => {
    it("is disabled without VF_LAKE_S3_BUCKET", () => {
      expect(isLakeColdTierEnabled()).toBe(false);
    });

    it("is enabled when VF_LAKE_S3_BUCKET is set", () => {
      process.env.VF_LAKE_S3_BUCKET = "vf-lake";
      expect(isLakeColdTierEnabled()).toBe(true);
    });

    it("surfaces the S3 config in getLakeConfig() only when the bucket is set", () => {
      process.env.VF_LAKE_CLICKHOUSE_URL = "http://clickhouse:8123";
      expect(getLakeConfig().s3).toBeNull();

      process.env.VF_LAKE_S3_BUCKET = "vf-lake";
      process.env.VF_LAKE_S3_REGION = "us-east-1";
      expect(getLakeConfig().s3).toEqual(
        expect.objectContaining({ bucket: "vf-lake", region: "us-east-1" }),
      );
    });
  });
});
