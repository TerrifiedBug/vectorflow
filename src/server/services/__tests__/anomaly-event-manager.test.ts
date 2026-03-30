import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  acknowledgeAnomaly,
  dismissAnomaly,
  listAnomalies,
  countOpenAnomalies,
} from "@/server/services/anomaly-event-manager";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const NOW = new Date("2026-03-29T12:00:00Z");

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("listAnomalies", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns anomalies filtered by environmentId", async () => {
    const mockAnomalies = [
      {
        id: "a-1",
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
        message: "Throughput drop",
        status: "open",
        detectedAt: NOW,
        acknowledgedAt: null,
        acknowledgedBy: null,
        dismissedAt: null,
        dismissedBy: null,
        createdAt: NOW,
        pipeline: { id: "pipe-1", name: "My Pipeline" },
      },
    ];

    prismaMock.anomalyEvent.findMany.mockResolvedValue(mockAnomalies as never);

    const result = await listAnomalies({
      environmentId: "env-1",
      status: "open",
    });

    expect(prismaMock.anomalyEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          environmentId: "env-1",
          status: "open",
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].anomalyType).toBe("throughput_drop");
  });

  it("filters by pipelineId when provided", async () => {
    prismaMock.anomalyEvent.findMany.mockResolvedValue([]);

    await listAnomalies({
      environmentId: "env-1",
      pipelineId: "pipe-1",
    });

    expect(prismaMock.anomalyEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          environmentId: "env-1",
          pipelineId: "pipe-1",
        }),
      }),
    );
  });
});

describe("acknowledgeAnomaly", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("sets status to acknowledged with user and timestamp", async () => {
    const mockUpdated = {
      id: "a-1",
      status: "acknowledged",
      acknowledgedAt: NOW,
      acknowledgedBy: "user-1",
    };

    prismaMock.anomalyEvent.findUnique.mockResolvedValue({
      id: "a-1",
      status: "open",
    } as never);
    prismaMock.anomalyEvent.update.mockResolvedValue(mockUpdated as never);

    const result = await acknowledgeAnomaly("a-1", "user-1");

    expect(prismaMock.anomalyEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "a-1" },
        data: expect.objectContaining({
          status: "acknowledged",
          acknowledgedBy: "user-1",
        }),
      }),
    );
    expect(result.status).toBe("acknowledged");
  });

  it("throws if anomaly is already dismissed", async () => {
    prismaMock.anomalyEvent.findUnique.mockResolvedValue({
      id: "a-1",
      status: "dismissed",
    } as never);

    await expect(acknowledgeAnomaly("a-1", "user-1")).rejects.toThrow(
      "Cannot acknowledge a dismissed anomaly",
    );
  });
});

describe("dismissAnomaly", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("sets status to dismissed with user and timestamp", async () => {
    const mockUpdated = {
      id: "a-1",
      status: "dismissed",
      dismissedAt: NOW,
      dismissedBy: "user-1",
    };

    prismaMock.anomalyEvent.findUnique.mockResolvedValue({
      id: "a-1",
      status: "open",
    } as never);
    prismaMock.anomalyEvent.update.mockResolvedValue(mockUpdated as never);

    const result = await dismissAnomaly("a-1", "user-1");

    expect(prismaMock.anomalyEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "a-1" },
        data: expect.objectContaining({
          status: "dismissed",
          dismissedBy: "user-1",
        }),
      }),
    );
    expect(result.status).toBe("dismissed");
  });
});

describe("countOpenAnomalies", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns counts grouped by pipelineId", async () => {
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.anomalyEvent.groupBy.mockResolvedValue([
      { pipelineId: "pipe-1", _count: { id: 3 } },
      { pipelineId: "pipe-2", _count: { id: 1 } },
    ] as never);

    const result = await countOpenAnomalies("env-1");

    expect(result).toEqual({
      "pipe-1": 3,
      "pipe-2": 1,
    });
  });

  it("returns empty map when no open anomalies", async () => {
    // @ts-expect-error - groupBy mock typing is complex
    prismaMock.anomalyEvent.groupBy.mockResolvedValue([] as never);

    const result = await countOpenAnomalies("env-1");

    expect(result).toEqual({});
  });
});
