import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSettings: {
      findUnique: vi.fn(),
    },
    pipelineMetric: { deleteMany: vi.fn() },
    nodeMetric: { deleteMany: vi.fn() },
    pipelineLog: { deleteMany: vi.fn() },
    nodeStatusEvent: { deleteMany: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/server/services/timescaledb", () => ({
  isTimescaleDbAvailable: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isTimescaleDbAvailable } from "@/server/services/timescaledb";
import { cleanupOldMetrics } from "../metrics-cleanup";

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

      // Verify PipelineMetric drop_chunks
      expect(mockQueryRaw).toHaveBeenCalledWith(
        expect.stringContaining("drop_chunks")
      );

      expect(result).toEqual({ method: "drop_chunks", tablesProcessed: 4 });
    });

    it("uses correct retention intervals from system settings", async () => {
      mockFindUnique.mockResolvedValue({
        id: "singleton",
        metricsRetentionDays: 14,
        logsRetentionDays: 5,
      } as never);
      mockQueryRaw.mockResolvedValue([]);

      await cleanupOldMetrics();

      // Check that the interval values match settings
      const calls = mockQueryRaw.mock.calls;

      // PipelineMetric — 14 days
      expect(calls[0][0]).toContain("PipelineMetric");
      expect(calls[0][0]).toContain("14 days");

      // NodeMetric — 14 days
      expect(calls[1][0]).toContain("NodeMetric");
      expect(calls[1][0]).toContain("14 days");

      // PipelineLog — 5 days
      expect(calls[2][0]).toContain("PipelineLog");
      expect(calls[2][0]).toContain("5 days");

      // NodeStatusEvent — 14 days
      expect(calls[3][0]).toContain("NodeStatusEvent");
      expect(calls[3][0]).toContain("14 days");
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
      mockFindUnique.mockResolvedValue(null);
      mockIsTimescale.mockReturnValue(true);
      mockQueryRaw.mockResolvedValue([]);

      await cleanupOldMetrics();

      const calls = mockQueryRaw.mock.calls;
      expect(calls[0][0]).toContain("7 days");
      expect(calls[2][0]).toContain("3 days");
    });
  });
});
