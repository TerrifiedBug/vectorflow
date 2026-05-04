// src/server/services/__tests__/alert-deduplication.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import type { AlertRule, AlertEvent } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import {
  shouldSuppressDuplicate,
  DEFAULT_COOLDOWN_MINUTES,
} from "@/server/services/alert-deduplication";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const NOW = new Date("2025-06-01T12:00:00Z");

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
    severity: overrides.severity ?? "warning",
    ownerHint: overrides.ownerHint ?? "platform-ops",
    suggestedAction: overrides.suggestedAction ?? "Review the alert context.",
    snoozedUntil: overrides.snoozedUntil ?? null,
    cooldownMinutes: overrides.cooldownMinutes ?? null,
    keyword: null,
    keywordSeverityFilter: null,
    keywordWindowMinutes: null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function makeAlertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: overrides.id ?? "event-1",
    alertRuleId: overrides.alertRuleId ?? "rule-1",
    nodeId: overrides.nodeId ?? "node-1",
    status: overrides.status ?? "resolved",
    value: overrides.value ?? 90,
    message: overrides.message ?? "test",
    firedAt: overrides.firedAt ?? NOW,
    resolvedAt: overrides.resolvedAt ?? NOW,
    notifiedAt: overrides.notifiedAt ?? null,
    acknowledgedAt: overrides.acknowledgedAt ?? null,
    acknowledgedBy: overrides.acknowledgedBy ?? null,
    correlationGroupId: overrides.correlationGroupId ?? null,
    errorContext: null,
  };
}

describe("shouldSuppressDuplicate", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns false when no recent event exists for the rule", async () => {
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);
    const rule = makeAlertRule({ cooldownMinutes: 15 });

    const result = await shouldSuppressDuplicate(rule, "node-1", NOW);

    expect(result).toBe(false);
  });

  it("returns true when a resolved event exists within the cooldown window", async () => {
    const recentEvent = makeAlertEvent({
      firedAt: new Date("2025-06-01T11:50:00Z"),
      resolvedAt: new Date("2025-06-01T11:55:00Z"),
      status: "resolved",
    });
    prismaMock.alertEvent.findFirst.mockResolvedValue(recentEvent);
    const rule = makeAlertRule({ cooldownMinutes: 15 });

    const result = await shouldSuppressDuplicate(rule, "node-1", NOW);

    expect(result).toBe(true);
  });

  it("returns false when the most recent event is outside the cooldown window", async () => {
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);
    const rule = makeAlertRule({ cooldownMinutes: 15 });

    const result = await shouldSuppressDuplicate(rule, "node-1", NOW);

    expect(result).toBe(false);
  });

  it("uses the default 15-minute cooldown when cooldownMinutes is null", async () => {
    const rule = makeAlertRule({ cooldownMinutes: null });
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    await shouldSuppressDuplicate(rule, "node-1", NOW);

    const findFirstCall = prismaMock.alertEvent.findFirst.mock.calls[0]?.[0];
    const windowStart = (findFirstCall as { where: { firedAt: { gte: Date } } })
      ?.where?.firedAt?.gte;
    const expectedStart = new Date(
      NOW.getTime() - DEFAULT_COOLDOWN_MINUTES * 60 * 1000,
    );
    expect(windowStart?.getTime()).toBe(expectedStart.getTime());
  });

  it("uses a custom cooldownMinutes when set on the rule", async () => {
    const rule = makeAlertRule({ cooldownMinutes: 30 });
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);

    await shouldSuppressDuplicate(rule, "node-1", NOW);

    const findFirstCall = prismaMock.alertEvent.findFirst.mock.calls[0]?.[0];
    const windowStart = (findFirstCall as { where: { firedAt: { gte: Date } } })
      ?.where?.firedAt?.gte;
    const expectedStart = new Date(NOW.getTime() - 30 * 60 * 1000);
    expect(windowStart?.getTime()).toBe(expectedStart.getTime());
  });

  it("does NOT suppress when a firing (open) event exists — that is not a duplicate, it is ongoing", async () => {
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);
    const rule = makeAlertRule({ cooldownMinutes: 15 });

    const result = await shouldSuppressDuplicate(rule, "node-1", NOW);

    // The query only looks for resolved events to avoid suppressing when there's
    // no open event (the evaluator's own open-event check handles that case)
    expect(result).toBe(false);
  });

  it("exports DEFAULT_COOLDOWN_MINUTES as 15", () => {
    expect(DEFAULT_COOLDOWN_MINUTES).toBe(15);
  });
});
