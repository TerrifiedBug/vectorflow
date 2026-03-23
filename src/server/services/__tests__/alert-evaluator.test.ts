import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import type { AlertRule, AlertEvent } from "@/generated/prisma";

// Create the mock and register it with vi.mock in a single step.
// vi.mock is hoisted above all imports, but the *factory function* executes
// lazily when the mocked module is first imported. Since `evaluateAlerts`
// (below) triggers that import, we need a stable reference to hand to the
// factory. We import `prisma` from the mocked module and cast it.
vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import { evaluateAlerts } from "@/server/services/alert-evaluator";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Fixture helpers ────────────────────────────────────────────────────────

const NOW = new Date("2025-06-01T12:00:00Z");

function makeAlertRule(
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
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    pipeline: overrides.pipeline ?? null,
  };
}

function makeAlertEvent(
  overrides: Partial<AlertEvent>,
): AlertEvent {
  return {
    id: overrides.id ?? "event-1",
    alertRuleId: overrides.alertRuleId ?? "rule-1",
    nodeId: overrides.nodeId ?? "node-1",
    status: overrides.status ?? "firing",
    value: overrides.value ?? 90,
    message: overrides.message ?? "CPU usage at 90.00 (threshold: > 80)",
    firedAt: overrides.firedAt ?? NOW,
    resolvedAt: overrides.resolvedAt ?? null,
    notifiedAt: overrides.notifiedAt ?? null,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("evaluateAlerts", () => {
  const NODE_ID = "node-1";
  const ENV_ID = "env-1";

  beforeEach(() => {
    mockReset(prismaMock);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  // Common setup: mock vectorNode.findUnique to return a running node
  function mockRunningNode(status = "RUNNING") {
    prismaMock.vectorNode.findUnique.mockResolvedValue({
      status,
    } as never);
  }

  // Common setup: mock alertRule.findMany to return the given rules
  function mockRules(
    rules: ReturnType<typeof makeAlertRule>[],
  ) {
    prismaMock.alertRule.findMany.mockResolvedValue(rules as never);
  }

  // ── Node not found ──────────────────────────────────────────────────────

  it("returns empty when node not found", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(null);

    const result = await evaluateAlerts(NODE_ID, ENV_ID);
    expect(result).toEqual([]);
  });

  // ── Event-based rules (no condition/threshold) ──────────────────────────

  it("skips event-based rules", async () => {
    mockRunningNode();
    mockRules([
      makeAlertRule({
        metric: "deploy_requested",
        condition: null,
        threshold: null,
      }),
    ]);

    const result = await evaluateAlerts(NODE_ID, ENV_ID);
    expect(result).toEqual([]);
    // No alertEvent calls should have been made
    expect(prismaMock.alertEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.alertEvent.findFirst).not.toHaveBeenCalled();
  });

  // ── Firing when condition met (cpu_usage > threshold) ───────────────────

  it("fires when condition met beyond duration", async () => {
    mockRunningNode();
    mockRules([
      makeAlertRule({
        metric: "cpu_usage",
        condition: "gt",
        threshold: 80,
        durationSeconds: 0,
      }),
    ]);

    // Mock two metric rows that compute to 90% CPU
    // CPU = (totalDelta - idleDelta) / totalDelta * 100
    // newer: total=200, idle=110; older: total=100, idle=100
    // totalDelta=100, idleDelta=10, usage = (100-10)/100 * 100 = 90%
    prismaMock.nodeMetric.findMany.mockResolvedValue([
      { cpuSecondsTotal: 200, cpuSecondsIdle: 110 },
      { cpuSecondsTotal: 100, cpuSecondsIdle: 100 },
    ] as never);

    // No existing firing event
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeAlertEvent({
      id: "new-event-1",
      value: 90,
      status: "firing",
    });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    const result = await evaluateAlerts(NODE_ID, ENV_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.event.status).toBe("firing");
    expect(result[0]!.event.value).toBe(90);
    expect(prismaMock.alertEvent.create).toHaveBeenCalledOnce();
  });

  // ── Deduplication: no duplicate when existing firing event ──────────────

  it("does not fire duplicate when existing firing event exists", async () => {
    mockRunningNode();
    mockRules([
      makeAlertRule({
        metric: "cpu_usage",
        condition: "gt",
        threshold: 80,
        durationSeconds: 0,
      }),
    ]);

    // 90% CPU
    prismaMock.nodeMetric.findMany.mockResolvedValue([
      { cpuSecondsTotal: 200, cpuSecondsIdle: 110 },
      { cpuSecondsTotal: 100, cpuSecondsIdle: 100 },
    ] as never);

    // Existing firing event → should deduplicate
    prismaMock.alertEvent.findFirst.mockResolvedValue(
      makeAlertEvent({ id: "existing-event", status: "firing" }) as never,
    );

    const result = await evaluateAlerts(NODE_ID, ENV_ID);

    expect(result).toEqual([]);
    expect(prismaMock.alertEvent.create).not.toHaveBeenCalled();
  });

  // ── Resolves when condition clears ──────────────────────────────────────

  it("resolves when condition clears", async () => {
    mockRunningNode();
    mockRules([
      makeAlertRule({
        metric: "cpu_usage",
        condition: "gt",
        threshold: 80,
        durationSeconds: 0,
      }),
    ]);

    // 30% CPU — below threshold, condition NOT met
    // totalDelta=100, idleDelta=70, usage = (100-70)/100*100 = 30%
    prismaMock.nodeMetric.findMany.mockResolvedValue([
      { cpuSecondsTotal: 200, cpuSecondsIdle: 170 },
      { cpuSecondsTotal: 100, cpuSecondsIdle: 100 },
    ] as never);

    // An open firing event exists → should be resolved
    const openEvent = makeAlertEvent({ id: "open-event", status: "firing" });
    prismaMock.alertEvent.findFirst.mockResolvedValue(openEvent as never);

    const resolvedEvent = makeAlertEvent({
      id: "open-event",
      status: "resolved",
      resolvedAt: NOW,
    });
    prismaMock.alertEvent.update.mockResolvedValue(resolvedEvent as never);

    const result = await evaluateAlerts(NODE_ID, ENV_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.event.status).toBe("resolved");
    expect(result[0]!.event.resolvedAt).toEqual(NOW);
    expect(prismaMock.alertEvent.update).toHaveBeenCalledOnce();
    expect(prismaMock.alertEvent.create).not.toHaveBeenCalled();
  });

  // ── Binary metric: node_unreachable ─────────────────────────────────────

  it("handles binary metric: node_unreachable", async () => {
    mockRunningNode("UNREACHABLE");
    mockRules([
      makeAlertRule({
        metric: "node_unreachable",
        condition: "eq",
        threshold: 1,
        durationSeconds: 0,
      }),
    ]);

    // No existing firing event
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeAlertEvent({
      id: "unreachable-event",
      value: 1,
      status: "firing",
    });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    const result = await evaluateAlerts(NODE_ID, ENV_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.event.status).toBe("firing");
    // node_unreachable is a binary metric — readMetricValue returns 1 for UNREACHABLE
    expect(prismaMock.alertEvent.create).toHaveBeenCalledOnce();
  });

  // ── Binary metric: pipeline_crashed ─────────────────────────────────────

  it("handles binary metric: pipeline_crashed", async () => {
    mockRunningNode();
    mockRules([
      makeAlertRule({
        metric: "pipeline_crashed",
        condition: "eq",
        threshold: 1,
        durationSeconds: 0,
      }),
    ]);

    // At least one crashed pipeline
    prismaMock.nodePipelineStatus.count.mockResolvedValue(2 as never);

    // No existing firing event
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeAlertEvent({
      id: "crashed-event",
      value: 1,
      status: "firing",
    });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    const result = await evaluateAlerts(NODE_ID, ENV_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.event.status).toBe("firing");
  });

  // ── Null metric: empty nodeMetric rows ──────────────────────────────────

  it("returns empty when metric value is null", async () => {
    mockRunningNode();
    mockRules([
      makeAlertRule({
        metric: "cpu_usage",
        condition: "gt",
        threshold: 80,
        durationSeconds: 0,
      }),
    ]);

    // No metric rows → getCpuUsage returns null
    prismaMock.nodeMetric.findMany.mockResolvedValue([] as never);

    const result = await evaluateAlerts(NODE_ID, ENV_ID);

    expect(result).toEqual([]);
    expect(prismaMock.alertEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.alertEvent.findFirst).not.toHaveBeenCalled();
  });

  // ── Duration tracking ───────────────────────────────────────────────────

  it("respects duration tracking — does not fire before duration elapsed", async () => {
    mockRunningNode();

    const rule = makeAlertRule({
      id: "duration-rule",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      durationSeconds: 60, // Must be over threshold for 60s
    });
    mockRules([rule]);

    // 90% CPU
    prismaMock.nodeMetric.findMany.mockResolvedValue([
      { cpuSecondsTotal: 200, cpuSecondsIdle: 110 },
      { cpuSecondsTotal: 100, cpuSecondsIdle: 100 },
    ] as never);

    // First call — sets conditionFirstSeen, but duration not yet elapsed
    const result1 = await evaluateAlerts(NODE_ID, ENV_ID);
    expect(result1).toEqual([]);
    expect(prismaMock.alertEvent.findFirst).not.toHaveBeenCalled();

    // Advance time by 61 seconds so duration requirement is met
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));

    // Re-mock since prismaMock resets aren't happening between these calls
    // (only beforeEach resets). We re-set the mocks for the second call.
    prismaMock.vectorNode.findUnique.mockResolvedValue({
      status: "RUNNING",
    } as never);
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);
    prismaMock.nodeMetric.findMany.mockResolvedValue([
      { cpuSecondsTotal: 200, cpuSecondsIdle: 110 },
      { cpuSecondsTotal: 100, cpuSecondsIdle: 100 },
    ] as never);
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    const createdEvent = makeAlertEvent({
      id: "duration-event",
      value: 90,
      status: "firing",
    });
    prismaMock.alertEvent.create.mockResolvedValue(createdEvent as never);

    // Second call — duration has elapsed, should fire
    const result2 = await evaluateAlerts(NODE_ID, ENV_ID);
    expect(result2).toHaveLength(1);
    expect(result2[0]!.event.status).toBe("firing");
  });

  // ── Condition clearing removes duration tracking ────────────────────────

  it("clears duration tracking when condition no longer met", async () => {
    mockRunningNode();

    const rule = makeAlertRule({
      id: "clear-duration-rule",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 80,
      durationSeconds: 60,
    });
    mockRules([rule]);

    // 90% CPU — condition met
    prismaMock.nodeMetric.findMany.mockResolvedValue([
      { cpuSecondsTotal: 200, cpuSecondsIdle: 110 },
      { cpuSecondsTotal: 100, cpuSecondsIdle: 100 },
    ] as never);

    // First call — sets conditionFirstSeen but duration not met
    const result1 = await evaluateAlerts(NODE_ID, ENV_ID);
    expect(result1).toEqual([]);

    // Now condition drops below threshold — 30% CPU
    prismaMock.vectorNode.findUnique.mockResolvedValue({
      status: "RUNNING",
    } as never);
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);
    prismaMock.nodeMetric.findMany.mockResolvedValue([
      { cpuSecondsTotal: 200, cpuSecondsIdle: 170 },
      { cpuSecondsTotal: 100, cpuSecondsIdle: 100 },
    ] as never);
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    // Second call — condition NOT met, should clear duration tracking
    const result2 = await evaluateAlerts(NODE_ID, ENV_ID);
    expect(result2).toEqual([]);

    // Advance time by 61s — but since duration was cleared, it should NOT fire
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));

    prismaMock.vectorNode.findUnique.mockResolvedValue({
      status: "RUNNING",
    } as never);
    prismaMock.alertRule.findMany.mockResolvedValue([rule] as never);
    // Back to 90% CPU
    prismaMock.nodeMetric.findMany.mockResolvedValue([
      { cpuSecondsTotal: 200, cpuSecondsIdle: 110 },
      { cpuSecondsTotal: 100, cpuSecondsIdle: 100 },
    ] as never);

    // Third call — condition met again but firstSeen was reset, so not enough time
    const result3 = await evaluateAlerts(NODE_ID, ENV_ID);
    expect(result3).toEqual([]);
  });

  // ── Message format includes pipeline name ───────────────────────────────

  it("includes pipeline name in event message when available", async () => {
    mockRunningNode();
    mockRules([
      makeAlertRule({
        metric: "cpu_usage",
        condition: "gt",
        threshold: 80,
        durationSeconds: 0,
        pipeline: { name: "My Pipeline" },
      }),
    ]);

    prismaMock.nodeMetric.findMany.mockResolvedValue([
      { cpuSecondsTotal: 200, cpuSecondsIdle: 110 },
      { cpuSecondsTotal: 100, cpuSecondsIdle: 100 },
    ] as never);

    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    prismaMock.alertEvent.create.mockImplementation(((args: {
      data: { message: string };
    }) => {
      return Promise.resolve(
        makeAlertEvent({ message: args.data.message }),
      );
    }) as never);

    const result = await evaluateAlerts(NODE_ID, ENV_ID);

    expect(result).toHaveLength(1);
    // buildMessage for numeric metrics with pipeline name:
    // "{pipelineName} — {metricLabel} at {value} (threshold: {cond} {threshold})"
    expect(result[0]!.event.message).toContain("My Pipeline");
    expect(result[0]!.event.message).toContain("CPU usage");
  });

  // ── No rules for environment ────────────────────────────────────────────

  it("returns empty when no enabled rules exist", async () => {
    mockRunningNode();
    mockRules([]);

    const result = await evaluateAlerts(NODE_ID, ENV_ID);
    expect(result).toEqual([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
