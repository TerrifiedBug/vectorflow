import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t, mockIsEventMetric } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return {
    t,
    mockIsEventMetric: vi.fn().mockReturnValue(false),
  };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requireSuperAdmin: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/event-alerts", () => ({
  isEventMetric: mockIsEventMetric,
}));

vi.mock("@/server/services/alert-evaluator", () => ({
  FLEET_METRICS: new Set([
    "fleet_error_rate",
    "fleet_throughput_drop",
    "latency_mean",
    "throughput_floor",
  ]),
  PIPELINE_FLEET_METRICS: new Set(["latency_mean", "throughput_floor"]),
  // Real implementation — testRule needs honest comparisons.
  checkCondition: (value: number, condition: string, threshold: number) => {
    switch (condition) {
      case "gt":
        return value > threshold;
      case "lt":
        return value < threshold;
      case "eq":
        return value === threshold;
      default:
        return false;
    }
  },
}));

const mockQueryPipelineMetricsAggregated = vi.fn();
vi.mock("@/server/services/metrics-query", () => ({
  queryPipelineMetricsAggregated: (
    ...args: Parameters<typeof mockQueryPipelineMetricsAggregated>
  ) => mockQueryPipelineMetricsAggregated(...args),
}));

import { prisma } from "@/lib/prisma";
import { alertRulesRouter } from "@/server/routers/alert-rules";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(alertRulesRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

function makeAlertRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    name: "High CPU",
    environmentId: "env-1",
    pipelineId: null,
    teamId: "team-1",
    metric: "cpu_usage",
    condition: "gt",
    threshold: 90,
    durationSeconds: 60,
    severity: "warning",
    ownerHint: "platform-ops",
    suggestedAction: "Review the alert context.",
    cooldownMinutes: 5,
    enabled: true,
    snoozedUntil: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    pipeline: null,
    channels: [],
    ...overrides,
  };
}

describe("alertRulesRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    mockIsEventMetric.mockReturnValue(false);
  });

  // ─── getRule ───────────────────────────────────────────────────────────────

  describe("getRule", () => {
    it("returns rule with environment, pipeline, and channel relations", async () => {
      const rule = makeAlertRule({
        environment: { id: "env-1", name: "production" },
        pipeline: { id: "pipe-1", name: "auditbeat" },
        channels: [
          {
            id: "arc-1",
            channelId: "ch-1",
            channel: { id: "ch-1", name: "ops-slack", type: "slack" },
          },
        ],
      });
      prismaMock.alertRule.findUnique.mockResolvedValue(rule as never);

      const result = await caller.getRule({ id: "rule-1", teamId: "team-1" });

      expect(result.id).toBe("rule-1");
      expect(result.channels).toHaveLength(1);
      expect(prismaMock.alertRule.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "rule-1" },
          include: expect.objectContaining({
            environment: { select: { id: true, name: true } },
            pipeline: { select: { id: true, name: true } },
            channels: { include: { channel: true } },
          }),
        }),
      );
    });

    it("throws NOT_FOUND when rule does not exist", async () => {
      prismaMock.alertRule.findUnique.mockResolvedValue(null);

      await expect(
        caller.getRule({ id: "rule-missing", teamId: "team-1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws NOT_FOUND when rule belongs to a different team", async () => {
      prismaMock.alertRule.findUnique.mockResolvedValue(
        makeAlertRule({ teamId: "team-2" }) as never,
      );

      await expect(
        caller.getRule({ id: "rule-1", teamId: "team-1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── listRules ─────────────────────────────────────────────────────────────

  describe("listRules", () => {
    it("returns alert rules for an environment", async () => {
      prismaMock.alertRule.findMany.mockResolvedValue([makeAlertRule()] as never);

      const result = await caller.listRules({ environmentId: "env-1" });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("High CPU");
    });

    it("returns empty array when no rules exist", async () => {
      prismaMock.alertRule.findMany.mockResolvedValue([]);

      const result = await caller.listRules({ environmentId: "env-1" });

      expect(result).toEqual([]);
    });
  });

  // ─── createRule ────────────────────────────────────────────────────────────

  describe("createRule", () => {
    it("creates a rule with condition and threshold", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.alertRule.create.mockResolvedValue(makeAlertRule() as never);

      const result = await caller.createRule({
        name: "High CPU",
        environmentId: "env-1",
        metric: "cpu_usage" as never,
        condition: "gt" as never,
        threshold: 90,
        durationSeconds: 60,
        teamId: "team-1",
      });

      expect(result.name).toBe("High CPU");
      expect(prismaMock.alertRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            severity: "warning",
            ownerHint: "platform-ops",
            suggestedAction:
              "Review the alert context, then inspect the affected pipeline, node, and recent deployment changes.",
          }),
        }),
      );
    });

    it("creates a rule with operational metadata", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.alertRule.create.mockResolvedValue(
        makeAlertRule({
          severity: "critical",
          ownerHint: "pipeline-owner",
          suggestedAction: "Roll back the last deployment if crashes continue.",
        }) as never,
      );

      await caller.createRule({
        name: "Pipeline Crashed",
        environmentId: "env-1",
        metric: "pipeline_crashed" as never,
        condition: "eq" as never,
        threshold: 1,
        durationSeconds: 60,
        severity: "critical",
        ownerHint: "pipeline-owner",
        suggestedAction: "Roll back the last deployment if crashes continue.",
        teamId: "team-1",
      });

      expect(prismaMock.alertRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            severity: "critical",
            ownerHint: "pipeline-owner",
            suggestedAction: "Roll back the last deployment if crashes continue.",
          }),
        }),
      );
    });

    it("creates a rule with channelIds", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.notificationChannel.count.mockResolvedValue(2);
      prismaMock.alertRule.create.mockResolvedValue(makeAlertRule({ id: "rule-new" }) as never);
      prismaMock.alertRuleChannel.createMany.mockResolvedValue({ count: 2 } as never);

      await caller.createRule({
        name: "With Channels",
        environmentId: "env-1",
        metric: "cpu_usage" as never,
        condition: "gt" as never,
        threshold: 80,
        teamId: "team-1",
        channelIds: ["ch-1", "ch-2"],
      });

      expect(prismaMock.alertRuleChannel.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { alertRuleId: "rule-new", channelId: "ch-1" },
            { alertRuleId: "rule-new", channelId: "ch-2" },
          ],
          skipDuplicates: true,
        }),
      );
    });

    it("throws NOT_FOUND if environment does not exist", async () => {
      prismaMock.environment.findUnique.mockResolvedValue(null);

      await expect(
        caller.createRule({
          name: "Test",
          environmentId: "env-missing",
          metric: "cpu_usage" as never,
          condition: "gt" as never,
          threshold: 90,
          teamId: "team-1",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws NOT_FOUND if pipeline does not exist or is in wrong environment", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.pipeline.findUnique.mockResolvedValue(null);

      await expect(
        caller.createRule({
          name: "Test",
          environmentId: "env-1",
          pipelineId: "pipe-missing",
          metric: "cpu_usage" as never,
          condition: "gt" as never,
          threshold: 90,
          teamId: "team-1",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws BAD_REQUEST for fleet metric with pipelineId", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.pipeline.findUnique.mockResolvedValue({ id: "pipe-1", environmentId: "env-1" } as never);

      await expect(
        caller.createRule({
          name: "Fleet Rule",
          environmentId: "env-1",
          pipelineId: "pipe-1",
          metric: "fleet_error_rate" as never,
          condition: "gt" as never,
          threshold: 5,
          teamId: "team-1",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws BAD_REQUEST for pipeline-scoped fleet metric without pipelineId", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);

      await expect(
        caller.createRule({
          name: "Latency Rule",
          environmentId: "env-1",
          metric: "latency_mean" as never,
          condition: "gt" as never,
          threshold: 500,
          teamId: "team-1",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("creates a pipeline-scoped fleet metric rule when pipelineId is provided", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.pipeline.findUnique.mockResolvedValue({ id: "pipe-1", environmentId: "env-1" } as never);
      prismaMock.alertRule.create.mockResolvedValue(
        makeAlertRule({ metric: "latency_mean", pipelineId: "pipe-1" }) as never,
      );

      await caller.createRule({
        name: "Pipeline Latency",
        environmentId: "env-1",
        pipelineId: "pipe-1",
        metric: "latency_mean" as never,
        condition: "gt" as never,
        threshold: 500,
        durationSeconds: 120,
        teamId: "team-1",
      });

      expect(prismaMock.alertRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metric: "latency_mean",
            pipelineId: "pipe-1",
          }),
        }),
      );
    });

    it("nullifies condition/threshold for event metrics", async () => {
      mockIsEventMetric.mockReturnValue(true);
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.alertRule.create.mockResolvedValue(
        makeAlertRule({ condition: null, threshold: null, durationSeconds: null }) as never,
      );

      await caller.createRule({
        name: "Deploy Alert",
        environmentId: "env-1",
        metric: "deploy_requested" as never,
        condition: "gt" as never,
        threshold: 1,
        teamId: "team-1",
      });

      expect(prismaMock.alertRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            condition: null,
            threshold: null,
            durationSeconds: null,
          }),
        }),
      );
    });

    it("throws BAD_REQUEST for infra metric without condition/threshold", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);

      await expect(
        caller.createRule({
          name: "Missing Threshold",
          environmentId: "env-1",
          metric: "cpu_usage" as never,
          teamId: "team-1",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws BAD_REQUEST if channelIds reference invalid channels", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.notificationChannel.count.mockResolvedValue(1); // Only 1 of 2 found

      await expect(
        caller.createRule({
          name: "Bad Channels",
          environmentId: "env-1",
          metric: "cpu_usage" as never,
          condition: "gt" as never,
          threshold: 90,
          teamId: "team-1",
          channelIds: ["ch-1", "ch-invalid"],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects whitespace-only ownerHint", async () => {
      await expect(
        caller.createRule({
          name: "Test",
          environmentId: "env-1",
          metric: "cpu_usage" as never,
          condition: "gt" as never,
          threshold: 90,
          teamId: "team-1",
          ownerHint: "   ",
        }),
      ).rejects.toThrow();
    });

    it("rejects whitespace-only suggestedAction", async () => {
      await expect(
        caller.createRule({
          name: "Test",
          environmentId: "env-1",
          metric: "cpu_usage" as never,
          condition: "gt" as never,
          threshold: 90,
          teamId: "team-1",
          suggestedAction: "   ",
        }),
      ).rejects.toThrow();
    });

    it("trims leading/trailing whitespace from ownerHint and suggestedAction", async () => {
      prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1" } as never);
      prismaMock.alertRule.create.mockResolvedValue(
        makeAlertRule({ ownerHint: "sre-team", suggestedAction: "Check logs." }) as never,
      );

      await caller.createRule({
        name: "Trim Test",
        environmentId: "env-1",
        metric: "cpu_usage" as never,
        condition: "gt" as never,
        threshold: 90,
        teamId: "team-1",
        ownerHint: "  sre-team  ",
        suggestedAction: "  Check logs.  ",
      });

      expect(prismaMock.alertRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerHint: "sre-team",
            suggestedAction: "Check logs.",
          }),
        }),
      );
    });
  });

  // ─── updateRule ────────────────────────────────────────────────────────────

  describe("updateRule", () => {
    it("updates a rule name", async () => {
      const existing = makeAlertRule();
      prismaMock.alertRule.findUnique.mockResolvedValue(existing as never);
      prismaMock.alertRule.update.mockResolvedValue({ ...existing, name: "Renamed" } as never);

      const result = await caller.updateRule({ id: "rule-1", name: "Renamed" });

      expect(result.name).toBe("Renamed");
    });

    it("updates operational metadata", async () => {
      const existing = makeAlertRule();
      prismaMock.alertRule.findUnique.mockResolvedValue(existing as never);
      prismaMock.alertRule.update.mockResolvedValue(
        {
          ...existing,
          severity: "critical",
          ownerHint: "platform-ops",
          suggestedAction: "Page the platform operator.",
        } as never,
      );

      await caller.updateRule({
        id: "rule-1",
        severity: "critical",
        ownerHint: "platform-ops",
        suggestedAction: "Page the platform operator.",
      });

      expect(prismaMock.alertRule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            severity: "critical",
            ownerHint: "platform-ops",
            suggestedAction: "Page the platform operator.",
          }),
        }),
      );
    });

    it("replaces channel links when channelIds provided", async () => {
      const existing = makeAlertRule();
      prismaMock.alertRule.findUnique.mockResolvedValue(existing as never);
      prismaMock.notificationChannel.count.mockResolvedValue(2);
      prismaMock.alertRule.update.mockResolvedValue(existing as never);

      const mockTx = {
        alertRuleChannel: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
      };
      prismaMock.$transaction.mockImplementation(async (fn) => {
        return (fn as (tx: unknown) => Promise<unknown>)(mockTx);
      });

      await caller.updateRule({
        id: "rule-1",
        channelIds: ["ch-1", "ch-2"],
      });

      expect(mockTx.alertRuleChannel.deleteMany).toHaveBeenCalledWith({
        where: { alertRuleId: "rule-1" },
      });
      expect(mockTx.alertRuleChannel.createMany).toHaveBeenCalledWith({
        data: [
          { alertRuleId: "rule-1", channelId: "ch-1" },
          { alertRuleId: "rule-1", channelId: "ch-2" },
        ],
        skipDuplicates: true,
      });
    });

    it("throws NOT_FOUND for missing rule", async () => {
      prismaMock.alertRule.findUnique.mockResolvedValue(null);

      await expect(
        caller.updateRule({ id: "rule-missing", name: "Test" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws BAD_REQUEST if channelIds reference invalid channels", async () => {
      const existing = makeAlertRule();
      prismaMock.alertRule.findUnique.mockResolvedValue(existing as never);
      prismaMock.notificationChannel.count.mockResolvedValue(1); // Only 1 of 2 found

      await expect(
        caller.updateRule({
          id: "rule-1",
          channelIds: ["ch-1", "ch-invalid"],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects whitespace-only ownerHint on update", async () => {
      await expect(
        caller.updateRule({ id: "rule-1", ownerHint: "   " }),
      ).rejects.toThrow();
    });

    it("rejects whitespace-only suggestedAction on update", async () => {
      await expect(
        caller.updateRule({ id: "rule-1", suggestedAction: "   " }),
      ).rejects.toThrow();
    });

    it("trims whitespace from ownerHint and suggestedAction on update", async () => {
      const existing = makeAlertRule();
      prismaMock.alertRule.findUnique.mockResolvedValue(existing as never);
      prismaMock.alertRule.update.mockResolvedValue(
        { ...existing, ownerHint: "sre-team", suggestedAction: "Restart the pod." } as never,
      );

      await caller.updateRule({
        id: "rule-1",
        ownerHint: "  sre-team  ",
        suggestedAction: "  Restart the pod.  ",
      });

      expect(prismaMock.alertRule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerHint: "sre-team",
            suggestedAction: "Restart the pod.",
          }),
        }),
      );
    });
  });

  // ─── deleteRule ────────────────────────────────────────────────────────────

  describe("deleteRule", () => {
    it("deletes an existing rule", async () => {
      prismaMock.alertRule.findUnique.mockResolvedValue(makeAlertRule() as never);
      prismaMock.alertRule.delete.mockResolvedValue(makeAlertRule() as never);

      const result = await caller.deleteRule({ id: "rule-1" });

      expect(result).toEqual({ deleted: true });
      expect(prismaMock.alertRule.delete).toHaveBeenCalledWith({ where: { id: "rule-1" } });
    });

    it("throws NOT_FOUND for missing rule", async () => {
      prismaMock.alertRule.findUnique.mockResolvedValue(null);

      await expect(
        caller.deleteRule({ id: "rule-missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── snoozeRule ────────────────────────────────────────────────────────────

  describe("snoozeRule", () => {
    it("snoozes a rule for the given duration", async () => {
      prismaMock.alertRule.findUnique.mockResolvedValue(makeAlertRule() as never);
      prismaMock.alertRule.update.mockResolvedValue(
        makeAlertRule({ snoozedUntil: new Date("2025-01-02") }) as never,
      );

      const result = await caller.snoozeRule({ id: "rule-1", duration: 60 });

      expect(result.snoozedUntil).toBeTruthy();
      expect(prismaMock.alertRule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "rule-1" },
          data: { snoozedUntil: expect.any(Date) },
        }),
      );
    });

    it("throws NOT_FOUND for missing rule", async () => {
      prismaMock.alertRule.findUnique.mockResolvedValue(null);

      await expect(
        caller.snoozeRule({ id: "rule-missing", duration: 60 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── unsnoozeRule ──────────────────────────────────────────────────────────

  // ─── testRule ──────────────────────────────────────────────────────────────

  describe("testRule", () => {
    function buildRow(opts: {
      ts: Date;
      eventsIn?: number;
      errorsTotal?: number;
      latencyMeanMs?: number | null;
    }) {
      return {
        timestamp: opts.ts,
        eventsIn: BigInt(opts.eventsIn ?? 0),
        eventsOut: BigInt(0),
        eventsDiscarded: BigInt(0),
        errorsTotal: BigInt(opts.errorsTotal ?? 0),
        bytesIn: BigInt(0),
        bytesOut: BigInt(0),
        utilization: 0,
        latencyMeanMs: opts.latencyMeanMs ?? null,
      };
    }

    it("returns a series + breach count for a supported metric", async () => {
      const start = new Date("2026-01-01T00:00:00Z").getTime();
      const rows = [
        buildRow({ ts: new Date(start + 0 * 30_000), latencyMeanMs: 100 }),
        buildRow({ ts: new Date(start + 1 * 30_000), latencyMeanMs: 300 }),
        buildRow({ ts: new Date(start + 2 * 30_000), latencyMeanMs: 320 }),
        buildRow({ ts: new Date(start + 3 * 30_000), latencyMeanMs: 340 }),
        buildRow({ ts: new Date(start + 4 * 30_000), latencyMeanMs: 100 }),
      ];
      mockQueryPipelineMetricsAggregated.mockResolvedValue({ rows });

      const result = await caller.testRule({
        teamId: "team-1",
        pipelineId: "pipe-1",
        metric: "latency_mean" as never,
        condition: "gt" as never,
        threshold: 250,
        durationSeconds: 60,
        lookbackHours: 6,
      });

      expect(result.supported).toBe(true);
      if (!result.supported) return; // type guard
      expect(result.series).toHaveLength(5);
      expect(result.wouldHaveFired).toBe(1);
      expect(result.breaches).toHaveLength(1);
      expect(result.threshold).toBe(250);
      expect(result.lookbackHours).toBe(6);
      expect(mockQueryPipelineMetricsAggregated).toHaveBeenCalledWith({
        pipelineId: "pipe-1",
        minutes: 360,
      });
    });

    it("returns supported:false for an event-based metric", async () => {
      const result = await caller.testRule({
        teamId: "team-1",
        pipelineId: "pipe-1",
        metric: "deploy_requested" as never,
        condition: "eq" as never,
        threshold: 1,
        durationSeconds: 0,
      });

      expect(result.supported).toBe(false);
      if (result.supported) return;
      expect(result.reason).toMatch(/event/i);
      expect(mockQueryPipelineMetricsAggregated).not.toHaveBeenCalled();
    });

    it("returns supported:false for a node-scoped metric", async () => {
      const result = await caller.testRule({
        teamId: "team-1",
        pipelineId: "pipe-1",
        metric: "cpu_usage" as never,
        condition: "gt" as never,
        threshold: 80,
        durationSeconds: 60,
      });

      expect(result.supported).toBe(false);
      if (result.supported) return;
      expect(result.reason).toMatch(/node/i);
    });

    it("returns supported:false when neither pipelineId nor environmentId provided", async () => {
      const result = await caller.testRule({
        teamId: "team-1",
        metric: "latency_mean" as never,
        condition: "gt" as never,
        threshold: 250,
        durationSeconds: 60,
      });

      expect(result.supported).toBe(false);
      if (result.supported) return;
      expect(result.reason).toMatch(/pipeline/i);
      expect(mockQueryPipelineMetricsAggregated).not.toHaveBeenCalled();
    });

    it("returns 0 fires when breaches are too brief to satisfy duration", async () => {
      const start = new Date("2026-01-01T00:00:00Z").getTime();
      const rows = [
        buildRow({ ts: new Date(start + 0 * 30_000), latencyMeanMs: 100 }),
        buildRow({ ts: new Date(start + 1 * 30_000), latencyMeanMs: 300 }),
        buildRow({ ts: new Date(start + 2 * 30_000), latencyMeanMs: 100 }),
      ];
      mockQueryPipelineMetricsAggregated.mockResolvedValue({ rows });

      const result = await caller.testRule({
        teamId: "team-1",
        pipelineId: "pipe-1",
        metric: "latency_mean" as never,
        condition: "gt" as never,
        threshold: 250,
        durationSeconds: 120,
      });

      expect(result.supported).toBe(true);
      if (!result.supported) return;
      expect(result.wouldHaveFired).toBe(0);
      expect(result.breaches).toEqual([]);
    });
  });

  describe("unsnoozeRule", () => {
    it("unsnoozes a rule by setting snoozedUntil to null", async () => {
      prismaMock.alertRule.findUnique.mockResolvedValue(
        makeAlertRule({ snoozedUntil: new Date() }) as never,
      );
      prismaMock.alertRule.update.mockResolvedValue(
        makeAlertRule({ snoozedUntil: null }) as never,
      );

      const result = await caller.unsnoozeRule({ id: "rule-1" });

      expect(result.snoozedUntil).toBeNull();
      expect(prismaMock.alertRule.update).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: { snoozedUntil: null },
      });
    });

    it("throws NOT_FOUND for missing rule", async () => {
      prismaMock.alertRule.findUnique.mockResolvedValue(null);

      await expect(
        caller.unsnoozeRule({ id: "rule-missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── findSimilar ───────────────────────────────────────────────────────────

  describe("findSimilar", () => {
    function makeMatch(overrides: Record<string, unknown> = {}) {
      return {
        id: "rule-1",
        name: "High CPU",
        metric: "cpu_usage",
        condition: "gt",
        threshold: 90,
        environment: { id: "env-1", name: "production" },
        pipeline: { id: "pipe-1", name: "auditbeat" },
        ...overrides,
      };
    }

    it("returns matches for same metric on same pipeline", async () => {
      prismaMock.alertRule.findMany.mockResolvedValue([makeMatch()] as never);

      const result = await caller.findSimilar({
        teamId: "team-1",
        pipelineId: "pipe-1",
        environmentId: "env-1",
        metric: "cpu_usage" as never,
      });

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.id).toBe("rule-1");
      const where = prismaMock.alertRule.findMany.mock.calls[0]![0]!.where!;
      expect(where).toEqual(
        expect.objectContaining({
          teamId: "team-1",
          metric: "cpu_usage",
        }),
      );
      // OR clause should target same pipeline
      expect(where.OR).toEqual(
        expect.arrayContaining([{ pipelineId: "pipe-1" }]),
      );
    });

    it("excludes the rule named in excludeId", async () => {
      prismaMock.alertRule.findMany.mockResolvedValue([] as never);

      await caller.findSimilar({
        teamId: "team-1",
        pipelineId: "pipe-1",
        environmentId: "env-1",
        metric: "cpu_usage" as never,
        excludeId: "rule-self",
      });

      const where = prismaMock.alertRule.findMany.mock.calls[0]![0]!.where!;
      expect(where).toEqual(
        expect.objectContaining({
          id: { not: "rule-self" },
        }),
      );
    });

    it("does NOT include id filter when excludeId not provided", async () => {
      prismaMock.alertRule.findMany.mockResolvedValue([] as never);

      await caller.findSimilar({
        teamId: "team-1",
        pipelineId: "pipe-1",
        environmentId: "env-1",
        metric: "cpu_usage" as never,
      });

      const where = prismaMock.alertRule.findMany.mock.calls[0]![0]!.where!;
      expect(where).not.toHaveProperty("id");
    });

    it("returns empty array when no overlapping rules exist", async () => {
      prismaMock.alertRule.findMany.mockResolvedValue([] as never);

      const result = await caller.findSimilar({
        teamId: "team-1",
        pipelineId: "pipe-1",
        environmentId: "env-1",
        metric: "cpu_usage" as never,
      });

      expect(result.matches).toEqual([]);
    });

    it("caps results at 3", async () => {
      prismaMock.alertRule.findMany.mockResolvedValue([] as never);

      await caller.findSimilar({
        teamId: "team-1",
        pipelineId: "pipe-1",
        environmentId: "env-1",
        metric: "cpu_usage" as never,
      });

      const args = prismaMock.alertRule.findMany.mock.calls[0]![0]!;
      expect(args.take).toBe(3);
    });

    it("matches team-wide rules when no pipelineId/environmentId provided", async () => {
      prismaMock.alertRule.findMany.mockResolvedValue([] as never);

      await caller.findSimilar({
        teamId: "team-1",
        metric: "cpu_usage" as never,
      });

      const where = prismaMock.alertRule.findMany.mock.calls[0]![0]!.where!;
      expect(where.OR).toEqual(
        expect.arrayContaining([{ pipelineId: null, environmentId: null }]),
      );
    });

    it("includes env-wide overlap when environmentId provided without pipelineId", async () => {
      prismaMock.alertRule.findMany.mockResolvedValue([] as never);

      await caller.findSimilar({
        teamId: "team-1",
        environmentId: "env-1",
        metric: "cpu_usage" as never,
      });

      const where = prismaMock.alertRule.findMany.mock.calls[0]![0]!.where!;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { pipelineId: null, environmentId: "env-1" },
          { environmentId: "env-1", pipelineId: null },
        ]),
      );
    });
  });
});
