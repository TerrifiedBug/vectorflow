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
  FLEET_METRICS: new Set(["fleet_error_rate", "fleet_throughput_drop"]),
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
      expect(prismaMock.alertRule.create).toHaveBeenCalled();
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
});
