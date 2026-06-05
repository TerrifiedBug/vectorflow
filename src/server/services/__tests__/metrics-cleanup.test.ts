import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => { const __pm = {
  systemSettings: {
    findUnique: vi.fn(),
  },
  organizationSettings: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn() },
  pipelineMetric: { deleteMany: vi.fn() },
  nodeMetric: { deleteMany: vi.fn() },
  pipelineLog: { deleteMany: vi.fn() },
  nodeStatusEvent: { deleteMany: vi.fn() },
  nodeMetricRollup: { deleteMany: vi.fn() },
  pipelineMetricRollup: { deleteMany: vi.fn() },
  $queryRawUnsafe: vi.fn(),
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/timescaledb", () => ({
  isTimescaleDbAvailable: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isTimescaleDbAvailable } from "@/server/services/timescaledb";
import { cleanupOldMetrics } from "../metrics-cleanup";
 import { mockOrgSettings } from "@/__tests__/helpers/mock-org-settings";

const mockFindUnique = vi.mocked(prisma.systemSettings.findUnique);
const mockQueryRaw = vi.mocked(prisma.$queryRawUnsafe);
const mockIsTimescale = vi.mocked(isTimescaleDbAvailable);

describe("cleanupOldMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({
      id: "singleton",
      metricsRetentionDays: 7,
      logsRetentionDays: 3,
    } as never);
 
    vi.mocked(prisma.organizationSettings.findUnique).mockResolvedValue(mockOrgSettings());
    vi.mocked(prisma.organizationSettings.upsert).mockResolvedValue(mockOrgSettings());
 
    vi.mocked(prisma.organizationSettings.create).mockResolvedValue(mockOrgSettings());
  });

  describe("when TimescaleDB is available", () => {
    beforeEach(() => {
      mockIsTimescale.mockReturnValue(true);
    });

    it("calls drop_chunks for all 4 tables", async () => {
      // drop_chunks returns a set of dropped chunk names — mock as empty arrays
      mockQueryRaw.mockResolvedValue([]);

      const result = await cleanupOldMetrics();

      // Expect 4 drop_chunks calls: PipelineMetric, NodeMetric (7d), PipelineLog, NodeStatusEvent (3d/7d)
      expect(mockQueryRaw).toHaveBeenCalledTimes(4);

      // Verify PipelineMetric drop_chunks (SQL text + bound day-count arg)
      expect(mockQueryRaw).toHaveBeenCalledWith(
        expect.stringContaining("drop_chunks"),
        expect.any(Number),
      );

      expect(result).toEqual({ method: "drop_chunks", tablesProcessed: 4 });
    });

    it("uses correct retention intervals from system settings", async () => {
      vi.mocked(prisma.organizationSettings.findUnique).mockResolvedValue(
        mockOrgSettings({
          metricsRetentionDays: 14,
          logsRetentionDays: 5,
        })
      );
      mockQueryRaw.mockResolvedValue([]);

      await cleanupOldMetrics();

      // The retention window is bound as a parameter (make_interval(days => $1))
      // rather than interpolated into the SQL text — verify the table name is
      // interpolated and the day count is passed as the bound argument.
      const calls = mockQueryRaw.mock.calls;

      // PipelineMetric — 14 days
      expect(calls[0][0]).toContain("PipelineMetric");
      expect(calls[0][0]).toContain("make_interval(days => $1)");
      expect(calls[0][1]).toBe(14);

      // NodeMetric — 14 days
      expect(calls[1][0]).toContain("NodeMetric");
      expect(calls[1][1]).toBe(14);

      // PipelineLog — 5 days
      expect(calls[2][0]).toContain("PipelineLog");
      expect(calls[2][1]).toBe(5);

      // NodeStatusEvent — 14 days
      expect(calls[3][0]).toContain("NodeStatusEvent");
      expect(calls[3][1]).toBe(14);
    });

    it("coerces a non-integer retention value to a safe integer (defense-in-depth)", async () => {
      vi.mocked(prisma.organizationSettings.findUnique).mockResolvedValue(
        mockOrgSettings({
          // Simulate a value that escaped the Int guard — must be coerced.
          metricsRetentionDays: 7.9 as unknown as number,
          logsRetentionDays: 0 as unknown as number,
        })
      );
      mockQueryRaw.mockResolvedValue([]);

      await cleanupOldMetrics();

      const calls = mockQueryRaw.mock.calls;
      // 7.9 -> trunc 7; never interpolated, always a bound integer arg.
      expect(calls[0][1]).toBe(7);
      // 0 -> clamped to minimum 1.
      expect(calls[2][1]).toBe(1);
      // No call SQL text should contain a raw "days" literal interpolation.
      for (const call of calls) {
        expect(call[0]).not.toMatch(/INTERVAL '/);
      }
    });
  });

  describe("when TimescaleDB is NOT available (fallback)", () => {
    beforeEach(() => {
      mockIsTimescale.mockReturnValue(false);
    });

    it("falls back to Prisma deleteMany for all 4 tables", async () => {
      vi.mocked(prisma.pipelineMetric.deleteMany).mockResolvedValue({ count: 100 });
      vi.mocked(prisma.nodeMetric.deleteMany).mockResolvedValue({ count: 50 });
      vi.mocked(prisma.pipelineLog.deleteMany).mockResolvedValue({ count: 30 });
      vi.mocked(prisma.nodeStatusEvent.deleteMany).mockResolvedValue({ count: 20 });

      const result = await cleanupOldMetrics();

      expect(prisma.pipelineMetric.deleteMany).toHaveBeenCalled();
      expect(prisma.nodeMetric.deleteMany).toHaveBeenCalled();
      expect(prisma.pipelineLog.deleteMany).toHaveBeenCalled();
      expect(prisma.nodeStatusEvent.deleteMany).toHaveBeenCalled();
      expect(mockQueryRaw).not.toHaveBeenCalled();

      expect(result).toEqual({ method: "deleteMany", deletedRows: 200 });
    });
  });

  describe("default settings", () => {
    it("uses 7-day metrics retention and 3-day logs retention when settings are missing", async () => {
      vi.mocked(prisma.organizationSettings.findUnique).mockResolvedValue(null);
      mockIsTimescale.mockReturnValue(true);
      mockQueryRaw.mockResolvedValue([]);

      await cleanupOldMetrics();

      const calls = mockQueryRaw.mock.calls;
      expect(calls[0][1]).toBe(7);
      expect(calls[2][1]).toBe(3);
    });
  });

  describe("rollup retention (independent of raw)", () => {
    it("purges rollups at metricsRollupRetentionDays while raw uses its own window", async () => {
      mockIsTimescale.mockReturnValue(true);
      mockQueryRaw.mockResolvedValue([]);
      vi.mocked(prisma.organizationSettings.findUnique).mockResolvedValue(
        mockOrgSettings({
          metricsRetentionDays: 7,
          metricsRollupRetentionDays: 90,
        }),
      );

      const before = Date.now();
      await cleanupOldMetrics();
      const after = Date.now();

      // Raw metrics still purged via drop_chunks (4 hypertables) at 7 days.
      expect(mockQueryRaw).toHaveBeenCalledTimes(4);

      // Rollups purged via deleteMany (not hypertables) at the 90-day cutoff.
      expect(prisma.nodeMetricRollup.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.pipelineMetricRollup.deleteMany).toHaveBeenCalledTimes(1);

      const arg = vi.mocked(prisma.nodeMetricRollup.deleteMany).mock
        .calls[0][0] as unknown as { where: { bucketStart: { lt: Date } } };
      const cutoff = arg.where.bucketStart.lt.getTime();
      const ninetyDays = 90 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeGreaterThanOrEqual(before - ninetyDays);
      expect(cutoff).toBeLessThanOrEqual(after - ninetyDays);
    });

    it("purges rollups even on the legacy (non-TimescaleDB) path", async () => {
      mockIsTimescale.mockReturnValue(false);
      vi.mocked(prisma.pipelineMetric.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.nodeMetric.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.pipelineLog.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.nodeStatusEvent.deleteMany).mockResolvedValue({ count: 0 });

      await cleanupOldMetrics();

      expect(prisma.nodeMetricRollup.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.pipelineMetricRollup.deleteMany).toHaveBeenCalledTimes(1);
    });

    it("defaults rollup retention to 90 days when the setting is unset", async () => {
      mockIsTimescale.mockReturnValue(true);
      mockQueryRaw.mockResolvedValue([]);
      vi.mocked(prisma.organizationSettings.findUnique).mockResolvedValue(
        // Force the field to be absent so cleanup must fall back to the default.
        mockOrgSettings({
          metricsRollupRetentionDays: undefined as unknown as number,
        }),
      );

      const before = Date.now();
      await cleanupOldMetrics();

      const arg = vi.mocked(prisma.pipelineMetricRollup.deleteMany).mock
        .calls[0][0] as unknown as { where: { bucketStart: { lt: Date } } };
      const cutoff = arg.where.bucketStart.lt.getTime();
      const ninetyDays = 90 * 24 * 60 * 60 * 1000;
      expect(before - cutoff).toBeGreaterThanOrEqual(ninetyDays - 5000);
      expect(before - cutoff).toBeLessThanOrEqual(ninetyDays + 5000);
    });
  });
});
