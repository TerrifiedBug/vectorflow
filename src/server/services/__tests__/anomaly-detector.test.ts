import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

describe("AnomalyEvent model", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("should create an anomaly event with required fields", async () => {
    const now = new Date("2026-03-29T12:00:00Z");
    const mockEvent = {
      id: "anomaly-1",
      pipelineId: "pipe-1",
      environmentId: "env-1",
      teamId: "team-1",
      anomalyType: "throughput_drop",
      severity: "warning",
      metricName: "eventsIn",
      currentValue: 100,
      baselineMean: 5000,
      baselineStddev: 500,
      deviationFactor: 9.8,
      message: "Throughput dropped to 100 (baseline: 5000 +/- 500)",
      status: "open",
      detectedAt: now,
      acknowledgedAt: null,
      acknowledgedBy: null,
      dismissedAt: null,
      dismissedBy: null,
      createdAt: now,
    };

    prismaMock.anomalyEvent.create.mockResolvedValue(mockEvent as never);

    const result = await prisma.anomalyEvent.create({
      data: {
        pipelineId: "pipe-1",
        environmentId: "env-1",
        teamId: "team-1",
        anomalyType: "throughput_drop",
        severity: "warning",
        metricName: "eventsIn",
        currentValue: 100,
        baselineMean: 5000,
        baselineStddev: 500,
        deviationFactor: 9.8,
        message: "Throughput dropped to 100 (baseline: 5000 +/- 500)",
        status: "open",
        detectedAt: now,
      },
    });

    expect(result.id).toBe("anomaly-1");
    expect(result.anomalyType).toBe("throughput_drop");
    expect(result.severity).toBe("warning");
    expect(result.status).toBe("open");
  });
});
