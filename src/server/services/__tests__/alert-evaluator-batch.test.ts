import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import type { AlertRule } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/drift-metrics", () => ({
  getConfigDrift: vi.fn(),
  getVersionDrift: vi.fn(),
  setExpectedChecksum: vi.fn(),
  clearExpectedChecksumCache: vi.fn(),
  getExpectedChecksums: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  evaluateAlertsBatch,
  buildMetricCache,
} from "@/server/services/alert-evaluator";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const NOW = new Date("2025-06-01T12:00:00Z");
const FIVE_MIN_AGO = new Date("2025-06-01T11:55:00Z");

function makeRule(
  overrides: Partial<AlertRule> & { pipeline?: { name: string } | null },
): AlertRule & { pipeline: { name: string } | null } {
  return {
    id: overrides.id ?? "rule-1",
    name: overrides.name ?? "Test Rule",
    enabled: overrides.enabled ?? true,
    environmentId: overrides.environmentId ?? "env-1",
    pipelineId: overrides.pipelineId ?? null,
    teamId: overrides.teamId ?? "team-1",
    metric: overrides.metric ?? "cpu_usage",
    condition: overrides.condition ?? "gt",
    threshold: overrides.threshold ?? 80,
    durationSeconds: overrides.durationSeconds ?? 0,
    snoozedUntil: overrides.snoozedUntil ?? null,
    cooldownMinutes: overrides.cooldownMinutes ?? null,
    keyword: null,
    keywordSeverityFilter: null,
    keywordWindowMinutes: null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    pipeline: overrides.pipeline ?? null,
  };
}

describe("buildMetricCache", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("pre-fetches node metrics and pipeline statuses in bulk", async () => {
    // Mock bulk queries
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "node-1", status: "HEALTHY" },
      { id: "node-2", status: "UNREACHABLE" },
    ] as never);

    // NodeMetric: 2 most recent per node for CPU calculation
    prismaMock.nodeMetric.findMany.mockResolvedValue([
      {
        nodeId: "node-1",
        timestamp: NOW,
        cpuSecondsTotal: 200,
        cpuSecondsIdle: 100,
        memoryUsedBytes: BigInt(4_000_000_000),
        memoryTotalBytes: BigInt(8_000_000_000),
        fsUsedBytes: BigInt(50_000_000_000),
        fsTotalBytes: BigInt(100_000_000_000),
      },
      {
        nodeId: "node-1",
        timestamp: FIVE_MIN_AGO,
        cpuSecondsTotal: 100,
        cpuSecondsIdle: 50,
        memoryUsedBytes: BigInt(3_500_000_000),
        memoryTotalBytes: BigInt(8_000_000_000),
        fsUsedBytes: BigInt(50_000_000_000),
        fsTotalBytes: BigInt(100_000_000_000),
      },
      {
        nodeId: "node-2",
        timestamp: NOW,
        cpuSecondsTotal: 300,
        cpuSecondsIdle: 200,
        memoryUsedBytes: BigInt(6_000_000_000),
        memoryTotalBytes: BigInt(8_000_000_000),
        fsUsedBytes: BigInt(80_000_000_000),
        fsTotalBytes: BigInt(100_000_000_000),
      },
      {
        nodeId: "node-2",
        timestamp: FIVE_MIN_AGO,
        cpuSecondsTotal: 200,
        cpuSecondsIdle: 150,
        memoryUsedBytes: BigInt(5_000_000_000),
        memoryTotalBytes: BigInt(8_000_000_000),
        fsUsedBytes: BigInt(80_000_000_000),
        fsTotalBytes: BigInt(100_000_000_000),
      },
    ] as never);

    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      {
        nodeId: "node-1",
        pipelineId: "pipe-1",
        status: "RUNNING",
        eventsIn: BigInt(1000),
        errorsTotal: BigInt(10),
        eventsDiscarded: BigInt(5),
      },
    ] as never);

    const cache = await buildMetricCache("env-1");

    // Should have made exactly 3 bulk queries
    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.nodeMetric.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.nodePipelineStatus.findMany).toHaveBeenCalledTimes(1);

    // Verify cache structure
    expect(cache.nodeStatuses.get("node-1")).toBe("HEALTHY");
    expect(cache.nodeStatuses.get("node-2")).toBe("UNREACHABLE");
    expect(cache.nodeIds).toEqual(["node-1", "node-2"]);
  });
});

describe("evaluateAlertsBatch", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("evaluates all rules against pre-built cache without per-rule queries", async () => {
    // Set up the bulk data
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "node-1", status: "HEALTHY" },
    ] as never);

    prismaMock.nodeMetric.findMany.mockResolvedValue([
      {
        nodeId: "node-1",
        timestamp: NOW,
        cpuSecondsTotal: 200,
        cpuSecondsIdle: 10,
        memoryUsedBytes: BigInt(7_000_000_000),
        memoryTotalBytes: BigInt(8_000_000_000),
        fsUsedBytes: BigInt(50_000_000_000),
        fsTotalBytes: BigInt(100_000_000_000),
      },
      {
        nodeId: "node-1",
        timestamp: FIVE_MIN_AGO,
        cpuSecondsTotal: 100,
        cpuSecondsIdle: 5,
        memoryUsedBytes: BigInt(6_000_000_000),
        memoryTotalBytes: BigInt(8_000_000_000),
        fsUsedBytes: BigInt(50_000_000_000),
        fsTotalBytes: BigInt(100_000_000_000),
      },
    ] as never);

    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([] as never);

    // Rules
    const rules = [
      makeRule({
        id: "rule-cpu",
        metric: "cpu_usage",
        condition: "gt",
        threshold: 80,
      }),
      makeRule({
        id: "rule-mem",
        metric: "memory_usage",
        condition: "gt",
        threshold: 50,
      }),
    ];

    prismaMock.alertRule.findMany.mockResolvedValue(rules as never);

    // No existing firing events
    prismaMock.alertEvent.findFirst.mockResolvedValue(null as never);

    // Mock event creation
    prismaMock.alertEvent.create.mockImplementation(((args: {
      data: { alertRuleId: string; nodeId: string; status: string; value: number; message: string };
    }) => {
      return Promise.resolve({
        id: `evt-${args.data.alertRuleId}`,
        ...args.data,
        firedAt: NOW,
        resolvedAt: null,
        notifiedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
      });
    }) as never);

    const results = await evaluateAlertsBatch("env-1");

    // Should NOT make individual nodeMetric/nodePipelineStatus queries per rule
    // Only the 3 bulk queries + rule query + event queries
    expect(prismaMock.nodeMetric.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.nodePipelineStatus.findMany).toHaveBeenCalledTimes(1);

    // Both rules should fire (CPU > 80%, memory > 50%)
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("resolves alerts when condition no longer met", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { id: "node-1", status: "HEALTHY" },
    ] as never);

    // CPU is low (well under threshold)
    prismaMock.nodeMetric.findMany.mockResolvedValue([
      {
        nodeId: "node-1",
        timestamp: NOW,
        cpuSecondsTotal: 200,
        cpuSecondsIdle: 180,
        memoryUsedBytes: BigInt(1_000_000_000),
        memoryTotalBytes: BigInt(8_000_000_000),
        fsUsedBytes: BigInt(10_000_000_000),
        fsTotalBytes: BigInt(100_000_000_000),
      },
      {
        nodeId: "node-1",
        timestamp: FIVE_MIN_AGO,
        cpuSecondsTotal: 100,
        cpuSecondsIdle: 90,
        memoryUsedBytes: BigInt(1_000_000_000),
        memoryTotalBytes: BigInt(8_000_000_000),
        fsUsedBytes: BigInt(10_000_000_000),
        fsTotalBytes: BigInt(100_000_000_000),
      },
    ] as never);

    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([] as never);

    const rules = [
      makeRule({
        id: "rule-cpu",
        metric: "cpu_usage",
        condition: "gt",
        threshold: 80,
      }),
    ];
    prismaMock.alertRule.findMany.mockResolvedValue(rules as never);

    // Existing open event that should be resolved
    const openEvent = {
      id: "evt-1",
      alertRuleId: "rule-cpu",
      nodeId: "node-1",
      status: "firing",
      value: 90,
      message: "CPU usage at 90.00",
      firedAt: FIVE_MIN_AGO,
      resolvedAt: null,
      notifiedAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
    };
    prismaMock.alertEvent.findFirst.mockResolvedValue(openEvent as never);
    prismaMock.alertEvent.update.mockResolvedValue({
      ...openEvent,
      status: "resolved",
      resolvedAt: NOW,
    } as never);

    const results = await evaluateAlertsBatch("env-1");

    expect(prismaMock.alertEvent.update).toHaveBeenCalled();
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.event.status === "resolved")).toBe(true);
  });
});
