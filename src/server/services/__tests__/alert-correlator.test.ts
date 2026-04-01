// src/server/services/__tests__/alert-correlator.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import type {
  AlertEvent,
  AlertRule,
  AlertCorrelationGroup,
} from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  correlateEvent,
  suggestRootCause,
  closeResolvedGroups,
  CORRELATION_WINDOW_MS,
} from "@/server/services/alert-correlator";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const NOW = new Date("2025-06-01T12:00:00Z");

function makeAlertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: overrides.id ?? "event-1",
    alertRuleId: overrides.alertRuleId ?? "rule-1",
    nodeId: overrides.nodeId ?? "node-1",
    status: overrides.status ?? "firing",
    value: overrides.value ?? 90,
    message: overrides.message ?? "CPU usage at 90.00",
    firedAt: overrides.firedAt ?? NOW,
    resolvedAt: overrides.resolvedAt ?? null,
    notifiedAt: overrides.notifiedAt ?? null,
    acknowledgedAt: overrides.acknowledgedAt ?? null,
    acknowledgedBy: overrides.acknowledgedBy ?? null,
    correlationGroupId: overrides.correlationGroupId ?? null,
    errorContext: null,
  };
}

function makeAlertRule(overrides: Partial<AlertRule> = {}): AlertRule {
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
  };
}

function makeCorrelationGroup(
  overrides: Partial<AlertCorrelationGroup> = {},
): AlertCorrelationGroup {
  return {
    id: overrides.id ?? "group-1",
    environmentId: overrides.environmentId ?? "env-1",
    status: overrides.status ?? "firing",
    rootCauseEventId: overrides.rootCauseEventId ?? null,
    rootCauseSuggestion: overrides.rootCauseSuggestion ?? null,
    eventCount: overrides.eventCount ?? 1,
    openedAt: overrides.openedAt ?? NOW,
    closedAt: overrides.closedAt ?? null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("correlateEvent", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("creates a new correlation group when no open group exists within the window", async () => {
    const event = makeAlertEvent({ id: "evt-new" });
    const rule = makeAlertRule({ environmentId: "env-1" });
    const newGroup = makeCorrelationGroup({
      id: "group-new",
      rootCauseEventId: "evt-new",
    });

    prismaMock.alertCorrelationGroup.findFirst.mockResolvedValue(null);
    prismaMock.alertCorrelationGroup.create.mockResolvedValue(newGroup);
    prismaMock.alertEvent.update.mockResolvedValue({
      ...event,
      correlationGroupId: "group-new",
    });

    const result = await correlateEvent(event, rule);

    expect(prismaMock.alertCorrelationGroup.findFirst).toHaveBeenCalledWith({
      where: {
        environmentId: "env-1",
        status: "firing",
        openedAt: { gte: expect.any(Date) },
      },
      orderBy: { openedAt: "desc" },
    });
    expect(prismaMock.alertCorrelationGroup.create).toHaveBeenCalledWith({
      data: {
        environmentId: "env-1",
        status: "firing",
        rootCauseEventId: "evt-new",
        eventCount: 1,
      },
    });
    expect(result.id).toBe("group-new");
  });

  it("assigns event to an existing open correlation group within the 5-min window", async () => {
    const event = makeAlertEvent({ id: "evt-2", nodeId: "node-1" });
    const rule = makeAlertRule({ environmentId: "env-1" });
    const existingGroup = makeCorrelationGroup({
      id: "group-existing",
      eventCount: 3,
    });

    prismaMock.alertCorrelationGroup.findFirst.mockResolvedValue(existingGroup);
    prismaMock.alertCorrelationGroup.update.mockResolvedValue({
      ...existingGroup,
      eventCount: 4,
    });
    prismaMock.alertEvent.update.mockResolvedValue({
      ...event,
      correlationGroupId: "group-existing",
    });

    const result = await correlateEvent(event, rule);

    expect(prismaMock.alertCorrelationGroup.update).toHaveBeenCalledWith({
      where: { id: "group-existing" },
      data: { eventCount: { increment: 1 } },
    });
    expect(prismaMock.alertEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-2" },
      data: { correlationGroupId: "group-existing" },
    });
    expect(result.id).toBe("group-existing");
  });

  it("uses the correct 5-minute correlation window", () => {
    expect(CORRELATION_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});

describe("suggestRootCause", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("suggests node_unreachable as root cause when present in group", async () => {
    const events = [
      makeAlertEvent({
        id: "evt-node-down",
        alertRuleId: "rule-node",
        firedAt: new Date("2025-06-01T11:58:00Z"),
        nodeId: "node-1",
      }),
      makeAlertEvent({
        id: "evt-pipeline-1",
        alertRuleId: "rule-pipeline",
        firedAt: new Date("2025-06-01T12:00:00Z"),
        nodeId: "node-1",
      }),
      makeAlertEvent({
        id: "evt-pipeline-2",
        alertRuleId: "rule-pipeline-2",
        firedAt: new Date("2025-06-01T12:01:00Z"),
        nodeId: "node-1",
      }),
    ];

    const rules = [
      makeAlertRule({ id: "rule-node", metric: "node_unreachable" }),
      makeAlertRule({
        id: "rule-pipeline",
        metric: "pipeline_crashed",
        pipelineId: "pipe-1",
      }),
      makeAlertRule({
        id: "rule-pipeline-2",
        metric: "error_rate",
        pipelineId: "pipe-2",
      }),
    ];

    prismaMock.alertEvent.findMany.mockResolvedValue(
      events.map((e) => ({
        ...e,
        alertRule: rules.find((r) => r.id === e.alertRuleId)!,
        node: { id: "node-1", host: "worker-1.example.com" },
      })) as never,
    );

    prismaMock.alertCorrelationGroup.update.mockResolvedValue(
      makeCorrelationGroup({ id: "group-1" }),
    );

    const suggestion = await suggestRootCause("group-1");

    expect(suggestion).toContain("node_unreachable");
    expect(suggestion).toContain("worker-1.example.com");
    expect(prismaMock.alertCorrelationGroup.update).toHaveBeenCalledWith({
      where: { id: "group-1" },
      data: {
        rootCauseEventId: "evt-node-down",
        rootCauseSuggestion: expect.stringContaining("node_unreachable"),
      },
    });
  });

  it("falls back to earliest-firing event when no node_unreachable alert exists", async () => {
    const events = [
      makeAlertEvent({
        id: "evt-earliest",
        alertRuleId: "rule-cpu",
        firedAt: new Date("2025-06-01T11:59:00Z"),
        nodeId: "node-1",
      }),
      makeAlertEvent({
        id: "evt-later",
        alertRuleId: "rule-mem",
        firedAt: new Date("2025-06-01T12:01:00Z"),
        nodeId: "node-1",
      }),
    ];

    const rules = [
      makeAlertRule({ id: "rule-cpu", metric: "cpu_usage", name: "High CPU" }),
      makeAlertRule({
        id: "rule-mem",
        metric: "memory_usage",
        name: "High Memory",
      }),
    ];

    prismaMock.alertEvent.findMany.mockResolvedValue(
      events.map((e) => ({
        ...e,
        alertRule: rules.find((r) => r.id === e.alertRuleId)!,
        node: { id: "node-1", host: "worker-1.example.com" },
      })) as never,
    );

    prismaMock.alertCorrelationGroup.update.mockResolvedValue(
      makeCorrelationGroup({ id: "group-1" }),
    );

    const suggestion = await suggestRootCause("group-1");

    expect(suggestion).toContain("High CPU");
    expect(prismaMock.alertCorrelationGroup.update).toHaveBeenCalledWith({
      where: { id: "group-1" },
      data: {
        rootCauseEventId: "evt-earliest",
        rootCauseSuggestion: expect.stringContaining("High CPU"),
      },
    });
  });

  it("returns null for a group with no events", async () => {
    prismaMock.alertEvent.findMany.mockResolvedValue([]);

    const suggestion = await suggestRootCause("group-empty");

    expect(suggestion).toBeNull();
    expect(prismaMock.alertCorrelationGroup.update).not.toHaveBeenCalled();
  });
});

describe("closeResolvedGroups", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("closes groups where all events are resolved", async () => {
    const group = makeCorrelationGroup({
      id: "group-resolved",
      status: "firing",
    });

    prismaMock.alertCorrelationGroup.findMany.mockResolvedValue([group]);
    prismaMock.alertEvent.count.mockResolvedValue(0);
    prismaMock.alertCorrelationGroup.update.mockResolvedValue({
      ...group,
      status: "resolved",
      closedAt: NOW,
    });

    const closed = await closeResolvedGroups("env-1");

    expect(closed).toBe(1);
    expect(prismaMock.alertCorrelationGroup.update).toHaveBeenCalledWith({
      where: { id: "group-resolved" },
      data: {
        status: "resolved",
        closedAt: expect.any(Date),
      },
    });
  });

  it("does not close groups that still have firing events", async () => {
    const group = makeCorrelationGroup({
      id: "group-still-firing",
      status: "firing",
    });

    prismaMock.alertCorrelationGroup.findMany.mockResolvedValue([group]);
    prismaMock.alertEvent.count.mockResolvedValue(2);

    const closed = await closeResolvedGroups("env-1");

    expect(closed).toBe(0);
    expect(prismaMock.alertCorrelationGroup.update).not.toHaveBeenCalled();
  });
});
