// src/server/services/__tests__/alert-correlation-integration.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import type {
  AlertRule,
  AlertEvent,
  AlertCorrelationGroup,
} from "@/generated/prisma";

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
import { shouldSuppressDuplicate } from "@/server/services/alert-deduplication";
import {
  correlateEvent,
  suggestRootCause,
  closeResolvedGroups,
} from "@/server/services/alert-correlator";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const NOW = new Date("2025-06-01T12:00:00Z");

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: overrides.id ?? "rule-1",
    name: overrides.name ?? "Test Rule",
    enabled: true,
    environmentId: overrides.environmentId ?? "env-1",
    pipelineId: overrides.pipelineId ?? null,
    teamId: "team-1",
    metric: overrides.metric ?? "cpu_usage",
    condition: overrides.condition ?? "gt",
    threshold: overrides.threshold ?? 80,
    durationSeconds: 0,
    snoozedUntil: null,
    cooldownMinutes: overrides.cooldownMinutes ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: overrides.id ?? "evt-1",
    alertRuleId: overrides.alertRuleId ?? "rule-1",
    nodeId: overrides.nodeId ?? "node-1",
    status: overrides.status ?? "firing",
    value: overrides.value ?? 90,
    message: overrides.message ?? "test",
    firedAt: overrides.firedAt ?? NOW,
    resolvedAt: overrides.resolvedAt ?? null,
    notifiedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    correlationGroupId: overrides.correlationGroupId ?? null,
  };
}

function makeGroup(
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

describe("Smart Alerting Integration", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  describe("deduplication + correlation flow", () => {
    it("suppresses a duplicate alert within cooldown window", async () => {
      const rule = makeRule({ cooldownMinutes: 15 });
      const recentResolved = makeEvent({
        id: "recent-resolved",
        status: "resolved",
        firedAt: new Date("2025-06-01T11:50:00Z"),
        resolvedAt: new Date("2025-06-01T11:55:00Z"),
      });

      prismaMock.alertEvent.findFirst.mockResolvedValue(recentResolved);

      const suppressed = await shouldSuppressDuplicate(rule, "node-1", NOW);
      expect(suppressed).toBe(true);
    });

    it("allows alert after cooldown window expires", async () => {
      const rule = makeRule({ cooldownMinutes: 5 });
      // Event resolved 10 minutes ago — outside 5-min cooldown
      prismaMock.alertEvent.findFirst.mockResolvedValue(null);

      const suppressed = await shouldSuppressDuplicate(rule, "node-1", NOW);
      expect(suppressed).toBe(false);
    });
  });

  describe("multi-alert correlation scenario", () => {
    it("correlates node_unreachable with subsequent pipeline alerts", async () => {
      const nodeRule = makeRule({
        id: "rule-node",
        metric: "node_unreachable",
      });
      const pipelineRule = makeRule({
        id: "rule-pipeline",
        metric: "pipeline_crashed",
        pipelineId: "pipe-1",
      });

      // First event: node goes unreachable — creates new group
      const nodeEvent = makeEvent({
        id: "evt-node",
        alertRuleId: "rule-node",
        firedAt: new Date("2025-06-01T11:58:00Z"),
      });

      prismaMock.alertCorrelationGroup.findFirst.mockResolvedValue(null);
      const newGroup = makeGroup({
        id: "group-cascade",
        rootCauseEventId: "evt-node",
        eventCount: 1,
      });
      prismaMock.alertCorrelationGroup.create.mockResolvedValue(newGroup);
      prismaMock.alertEvent.update.mockResolvedValue({
        ...nodeEvent,
        correlationGroupId: "group-cascade",
      });

      const group1 = await correlateEvent(nodeEvent, nodeRule);
      expect(group1.id).toBe("group-cascade");
      expect(group1.eventCount).toBe(1);

      // Second event: pipeline crashes 2 min later — joins existing group
      const pipelineEvent = makeEvent({
        id: "evt-pipeline",
        alertRuleId: "rule-pipeline",
        firedAt: new Date("2025-06-01T12:00:00Z"),
      });

      prismaMock.alertCorrelationGroup.findFirst.mockResolvedValue(newGroup);
      prismaMock.alertCorrelationGroup.update.mockResolvedValue({
        ...newGroup,
        eventCount: 2,
      });
      prismaMock.alertEvent.update.mockResolvedValue({
        ...pipelineEvent,
        correlationGroupId: "group-cascade",
      });

      const group2 = await correlateEvent(pipelineEvent, pipelineRule);
      expect(group2.eventCount).toBe(2);
    });

    it("suggests node_unreachable as root cause in a cascading group", async () => {
      const events = [
        {
          ...makeEvent({
            id: "evt-node",
            alertRuleId: "rule-node",
            firedAt: new Date("2025-06-01T11:58:00Z"),
          }),
          alertRule: makeRule({
            id: "rule-node",
            metric: "node_unreachable",
            name: "Node Down",
          }),
          node: { id: "node-1", host: "worker-1.example.com" },
        },
        {
          ...makeEvent({
            id: "evt-pipe1",
            alertRuleId: "rule-pipe1",
            firedAt: new Date("2025-06-01T12:00:00Z"),
          }),
          alertRule: makeRule({
            id: "rule-pipe1",
            metric: "pipeline_crashed",
            name: "Pipeline Crashed",
          }),
          node: { id: "node-1", host: "worker-1.example.com" },
        },
        {
          ...makeEvent({
            id: "evt-pipe2",
            alertRuleId: "rule-pipe2",
            firedAt: new Date("2025-06-01T12:01:00Z"),
          }),
          alertRule: makeRule({
            id: "rule-pipe2",
            metric: "error_rate",
            name: "High Error Rate",
          }),
          node: { id: "node-1", host: "worker-1.example.com" },
        },
      ];

      prismaMock.alertEvent.findMany.mockResolvedValue(events as never);
      prismaMock.alertCorrelationGroup.update.mockResolvedValue(
        makeGroup({ id: "group-cascade" }),
      );

      const suggestion = await suggestRootCause("group-cascade");

      expect(suggestion).toContain("node_unreachable");
      expect(suggestion).toContain("worker-1.example.com");
      expect(suggestion).toContain("2 related alerts");
    });
  });

  describe("group lifecycle", () => {
    it("closes a group when all events are resolved", async () => {
      const openGroup = makeGroup({ id: "group-closing", status: "firing" });
      prismaMock.alertCorrelationGroup.findMany.mockResolvedValue([openGroup]);
      prismaMock.alertEvent.count.mockResolvedValue(0); // no active events
      prismaMock.alertCorrelationGroup.update.mockResolvedValue({
        ...openGroup,
        status: "resolved",
        closedAt: NOW,
      });

      const closedCount = await closeResolvedGroups("env-1");
      expect(closedCount).toBe(1);
    });

    it("keeps a group open when some events are still firing", async () => {
      const openGroup = makeGroup({
        id: "group-still-active",
        status: "firing",
      });
      prismaMock.alertCorrelationGroup.findMany.mockResolvedValue([openGroup]);
      prismaMock.alertEvent.count.mockResolvedValue(1); // 1 still firing

      const closedCount = await closeResolvedGroups("env-1");
      expect(closedCount).toBe(0);
    });
  });
});
