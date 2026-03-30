// src/server/services/__tests__/cost-alert.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/cost-attribution", () => ({
  getCurrentMonthCostCents: vi.fn(),
  computeCostCents: vi.fn((bytes: number, rate: number) =>
    Math.round((bytes / 1_073_741_824) * rate)
  ),
}));

vi.mock("@/server/services/channels", () => ({
  deliverToChannels: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/server/services/webhook-delivery", () => ({
  deliverSingleWebhook: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/server/services/delivery-tracking", () => ({
  trackWebhookDelivery: vi.fn().mockResolvedValue({ success: true }),
}));

import { prisma } from "@/lib/prisma";
import { getCurrentMonthCostCents } from "@/server/services/cost-attribution";
import { evaluateCostAlerts } from "@/server/services/cost-alert";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockGetCurrentMonthCostCents = getCurrentMonthCostCents as ReturnType<typeof vi.fn>;

describe("evaluateCostAlerts", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("fires alert when monthly cost exceeds budget", async () => {
    // Environment with $100 budget (10000 cents)
    prismaMock.alertRule.findMany.mockResolvedValue([
      {
        id: "rule-1",
        name: "Cost Budget Alert",
        metric: "cost_threshold_exceeded",
        condition: "gt",
        threshold: 0, // threshold is on the alert rule but budget comes from env
        durationSeconds: null,
        enabled: true,
        environmentId: "env-1",
        pipelineId: null,
        teamId: "team-1",
        snoozedUntil: null,
        environment: {
          id: "env-1",
          name: "Production",
          costPerGbCents: 100,
          costBudgetCents: 10000,
          team: { name: "Platform" },
        },
      },
    ] as never);

    // Current month cost = $120 (12000 cents) > $100 budget
    mockGetCurrentMonthCostCents.mockResolvedValue(12000);

    // No existing firing alert
    prismaMock.alertEvent.findFirst.mockResolvedValue(null);
    prismaMock.alertEvent.create.mockResolvedValue({
      id: "event-1",
      alertRuleId: "rule-1",
      status: "firing",
      value: 12000,
      message: "Monthly cost $120.00 exceeds budget $100.00",
      firedAt: new Date(),
    } as never);

    // Mock webhook/channel queries
    prismaMock.alertWebhook.findMany.mockResolvedValue([]);
    prismaMock.alertRuleChannel.findMany.mockResolvedValue([]);

    const results = await evaluateCostAlerts();

    expect(results).toHaveLength(1);
    expect(prismaMock.alertEvent.create).toHaveBeenCalledOnce();
  });

  it("does not fire when cost is under budget", async () => {
    prismaMock.alertRule.findMany.mockResolvedValue([
      {
        id: "rule-1",
        name: "Cost Budget Alert",
        metric: "cost_threshold_exceeded",
        condition: "gt",
        threshold: 0,
        durationSeconds: null,
        enabled: true,
        environmentId: "env-1",
        pipelineId: null,
        teamId: "team-1",
        snoozedUntil: null,
        environment: {
          id: "env-1",
          name: "Production",
          costPerGbCents: 100,
          costBudgetCents: 10000,
          team: { name: "Platform" },
        },
      },
    ] as never);

    // Current month cost = $50 (5000 cents) < $100 budget
    mockGetCurrentMonthCostCents.mockResolvedValue(5000);

    const results = await evaluateCostAlerts();

    expect(results).toHaveLength(0);
    expect(prismaMock.alertEvent.create).not.toHaveBeenCalled();
  });

  it("skips environments without costBudgetCents set", async () => {
    prismaMock.alertRule.findMany.mockResolvedValue([
      {
        id: "rule-1",
        name: "Cost Budget Alert",
        metric: "cost_threshold_exceeded",
        condition: "gt",
        threshold: 0,
        durationSeconds: null,
        enabled: true,
        environmentId: "env-1",
        pipelineId: null,
        teamId: "team-1",
        snoozedUntil: null,
        environment: {
          id: "env-1",
          name: "Production",
          costPerGbCents: 100,
          costBudgetCents: null,
          team: { name: "Platform" },
        },
      },
    ] as never);

    const results = await evaluateCostAlerts();

    expect(results).toHaveLength(0);
    expect(mockGetCurrentMonthCostCents).not.toHaveBeenCalled();
  });

  it("resolves existing firing alert when cost drops below budget", async () => {
    prismaMock.alertRule.findMany.mockResolvedValue([
      {
        id: "rule-1",
        name: "Cost Budget Alert",
        metric: "cost_threshold_exceeded",
        condition: "gt",
        threshold: 0,
        durationSeconds: null,
        enabled: true,
        environmentId: "env-1",
        pipelineId: null,
        teamId: "team-1",
        snoozedUntil: null,
        environment: {
          id: "env-1",
          name: "Production",
          costPerGbCents: 100,
          costBudgetCents: 10000,
          team: { name: "Platform" },
        },
      },
    ] as never);

    // Under budget now
    mockGetCurrentMonthCostCents.mockResolvedValue(8000);

    // Existing firing alert
    prismaMock.alertEvent.findFirst.mockResolvedValue({
      id: "event-existing",
      alertRuleId: "rule-1",
      status: "firing",
    } as never);

    prismaMock.alertEvent.update.mockResolvedValue({
      id: "event-existing",
      status: "resolved",
    } as never);

    const results = await evaluateCostAlerts();

    expect(results).toHaveLength(0);
    expect(prismaMock.alertEvent.update).toHaveBeenCalledWith({
      where: { id: "event-existing" },
      data: { status: "resolved", resolvedAt: expect.any(Date) },
    });
  });
});
