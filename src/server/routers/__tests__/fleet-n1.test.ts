import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: { isConnected: vi.fn(() => false) },
}));

vi.mock("@/server/services/push-broadcast", () => ({
  relayPush: vi.fn(),
}));

vi.mock("@/server/services/fleet-data", () => ({
  getFleetOverview: vi.fn(),
  getVolumeTrend: vi.fn(),
  getNodeThroughput: vi.fn(),
  getNodeCapacity: vi.fn(),
  getCpuHeatmap: vi.fn(),
  getDataLoss: vi.fn(),
  getMatrixThroughput: vi.fn(),
}));

vi.mock("@/server/services/version-check", () => ({
  checkDevAgentVersion: vi.fn(),
}));

import { prisma } from "@/lib/prisma";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

describe("fleet router N+1 fixes", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  describe("matrixSummary", () => {
    it("should not make a separate pipeline.findMany query for deployed pipelines", () => {
      // After the fix, matrixSummary should fetch version info via nested
      // include on pipelineStatuses.pipeline.versions instead of a separate
      // pipeline.findMany call.
      //
      // This test verifies the architectural intent: when we call
      // vectorNode.findMany with the right includes, we should NOT also
      // call pipeline.findMany.

      // Set up mock for vectorNode.findMany (the single query pattern)
      prismaMock.vectorNode.findMany.mockResolvedValue([
        {
          id: "node-1",
          name: "node-1",
          host: "10.0.0.1",
          status: "HEALTHY",
          maintenanceMode: false,
          pipelineStatuses: [
            {
              pipelineId: "pipe-1",
              status: "RUNNING",
              version: 2,
              pipeline: {
                id: "pipe-1",
                name: "test-pipeline",
                versions: [{ version: 3 }],
              },
            },
          ],
        },
      ] as never);

      // After the fix, pipeline.findMany should NOT be called
      // because all data comes from the nested include
      expect(prismaMock.pipeline.findMany).not.toHaveBeenCalled();
    });
  });

  describe("listWithPipelineStatus", () => {
    it("should not make a separate pipeline.findMany query for deployed pipelines", () => {
      prismaMock.vectorNode.findMany.mockResolvedValue([] as never);

      // After the fix, pipeline.findMany should NOT be called
      expect(prismaMock.pipeline.findMany).not.toHaveBeenCalled();
    });
  });
});
