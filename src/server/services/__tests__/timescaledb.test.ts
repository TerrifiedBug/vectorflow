import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import {
  detectTimescaleDb,
  isTimescaleDbAvailable,
  getTimescaleDbConfig,
} from "../timescaledb";

const mockQueryRaw = vi.mocked(prisma.$queryRawUnsafe);

describe("timescaledb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the cached state between tests
    vi.resetModules();
  });

  describe("detectTimescaleDb", () => {
    it("returns true when timescaledb extension exists", async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { extname: "timescaledb", extversion: "2.17.0" },
      ]);

      const result = await detectTimescaleDb();

      expect(result).toBe(true);
      expect(mockQueryRaw).toHaveBeenCalledWith(
        "SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb'"
      );
    });

    it("returns false when timescaledb extension is not installed", async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await detectTimescaleDb();

      expect(result).toBe(false);
    });

    it("returns false when query throws (plain PostgreSQL)", async () => {
      mockQueryRaw.mockRejectedValueOnce(new Error("relation does not exist"));

      const result = await detectTimescaleDb();

      expect(result).toBe(false);
    });

    it("respects TIMESCALEDB_ENABLED=false override", async () => {
      process.env.TIMESCALEDB_ENABLED = "false";

      const result = await detectTimescaleDb();

      expect(result).toBe(false);
      expect(mockQueryRaw).not.toHaveBeenCalled();

      delete process.env.TIMESCALEDB_ENABLED;
    });

    it("respects TIMESCALEDB_ENABLED=true override (skips detection)", async () => {
      process.env.TIMESCALEDB_ENABLED = "true";

      const result = await detectTimescaleDb();

      expect(result).toBe(true);
      expect(mockQueryRaw).not.toHaveBeenCalled();

      delete process.env.TIMESCALEDB_ENABLED;
    });
  });

  describe("getTimescaleDbConfig", () => {
    it("returns default config values", () => {
      const config = getTimescaleDbConfig();

      expect(config.chunkInterval).toBe("1 day");
      expect(config.compressAfter).toBe("24 hours");
    });

    it("reads config from environment variables", () => {
      process.env.METRICS_CHUNK_INTERVAL = "12 hours";
      process.env.METRICS_COMPRESS_AFTER = "48 hours";

      const config = getTimescaleDbConfig();

      expect(config.chunkInterval).toBe("12 hours");
      expect(config.compressAfter).toBe("48 hours");

      delete process.env.METRICS_CHUNK_INTERVAL;
      delete process.env.METRICS_COMPRESS_AFTER;
    });
  });
});
