import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => { const __pm = {
  $queryRawUnsafe: vi.fn(),
  systemSettings: { findUnique: vi.fn() },
  organizationSettings: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn() },
  pipelineMetric: {
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  nodeMetric: {
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  pipelineLog: { deleteMany: vi.fn() },
  nodeStatusEvent: { deleteMany: vi.fn() },
  nodeMetricRollup: { deleteMany: vi.fn() },
  pipelineMetricRollup: { deleteMany: vi.fn() },
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/timescaledb", () => ({
  isTimescaleDbAvailable: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isTimescaleDbAvailable } from "@/server/services/timescaledb";
import { cleanupOldMetrics } from "../metrics-cleanup";
import {
  resolveMetricsSource,
  queryPipelineMetricsAggregated,
} from "../metrics-query";
 import { mockOrgSettings } from "@/__tests__/helpers/mock-org-settings";

const mockIsTimescale = vi.mocked(isTimescaleDbAvailable);
 const mockOrgSettingsValue = mockOrgSettings();

describe("TimescaleDB fallback integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
 
    vi.mocked(prisma.organizationSettings.findUnique).mockResolvedValue(mockOrgSettingsValue);
    vi.mocked(prisma.organizationSettings.upsert).mockResolvedValue(mockOrgSettingsValue);
 
    vi.mocked(prisma.organizationSettings.create).mockResolvedValue(mockOrgSettingsValue);
  });

  describe("when TimescaleDB is NOT available", () => {
    beforeEach(() => {
      mockIsTimescale.mockReturnValue(false);
    });

    it("resolveMetricsSource always returns raw", () => {
      expect(resolveMetricsSource(60)).toBe("raw");
      expect(resolveMetricsSource(1440)).toBe("raw");
      expect(resolveMetricsSource(10080)).toBe("raw");
    });

    it("cleanup uses deleteMany instead of drop_chunks", async () => {
      vi.mocked(prisma.systemSettings.findUnique).mockResolvedValue({
        id: "singleton",
        metricsRetentionDays: 7,
        logsRetentionDays: 3,
      } as never);
      vi.mocked(prisma.pipelineMetric.deleteMany).mockResolvedValue({ count: 10 });
      vi.mocked(prisma.nodeMetric.deleteMany).mockResolvedValue({ count: 5 });
      vi.mocked(prisma.pipelineLog.deleteMany).mockResolvedValue({ count: 3 });
      vi.mocked(prisma.nodeStatusEvent.deleteMany).mockResolvedValue({ count: 2 });

      const result = await cleanupOldMetrics();

      expect(result.method).toBe("deleteMany");
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it("query falls back to raw Prisma findMany for long ranges", async () => {
      vi.mocked(prisma.pipelineMetric.findMany).mockResolvedValue([]);

      const result = await queryPipelineMetricsAggregated({
        pipelineId: "pipe-1",
        minutes: 10080, // 7 days — would normally use 1h aggregate
      });

      expect(prisma.pipelineMetric.findMany).toHaveBeenCalled();
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(result.rows).toEqual([]);
    });
  });
});
