import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { TRPCError } from "@trpc/server";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requireSuperAdmin: passthrough,
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

import { prisma } from "@/lib/prisma";
import { alertEventsRouter } from "@/server/routers/alert-events";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(alertEventsRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

function makeAlertEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    alertRuleId: "rule-1",
    nodeId: "node-1",
    status: "firing",
    value: 95,
    message: "CPU usage exceeded threshold",
    firedAt: new Date("2025-01-01T12:00:00Z"),
    resolvedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    correlationGroupId: null,
    alertRule: {
      id: "rule-1",
      name: "High CPU",
      metric: "cpu_usage",
      condition: "gt",
      threshold: 90,
      pipeline: null,
    },
    node: { id: "node-1", host: "worker-1" },
    ...overrides,
  };
}

describe("alertEventsRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── listEvents ────────────────────────────────────────────────────────────

  describe("listEvents", () => {
    it("returns events with pagination", async () => {
      const events = [makeAlertEvent()];
      prismaMock.alertEvent.findMany.mockResolvedValue(events as never);

      const result = await caller.listEvents({ environmentId: "env-1" });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });

    it("returns nextCursor when more items exist", async () => {
      // Default limit is 50, so returning 51 items means there's a next page
      const events = Array.from({ length: 51 }, (_, i) =>
        makeAlertEvent({ id: `evt-${i}` }),
      );
      prismaMock.alertEvent.findMany.mockResolvedValue(events as never);

      const result = await caller.listEvents({ environmentId: "env-1", limit: 50 });

      expect(result.items).toHaveLength(50);
      expect(result.nextCursor).toBe("evt-50");
    });

    it("filters by status", async () => {
      prismaMock.alertEvent.findMany.mockResolvedValue([
        makeAlertEvent({ status: "resolved" }),
      ] as never);

      const result = await caller.listEvents({
        environmentId: "env-1",
        status: "resolved",
      });

      expect(result.items).toHaveLength(1);
      expect(prismaMock.alertEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "resolved",
          }),
        }),
      );
    });

    it("filters by date range", async () => {
      prismaMock.alertEvent.findMany.mockResolvedValue([] as never);

      await caller.listEvents({
        environmentId: "env-1",
        dateFrom: "2025-01-01",
        dateTo: "2025-01-31",
      });

      expect(prismaMock.alertEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            firedAt: expect.objectContaining({
              gte: new Date("2025-01-01"),
              lte: new Date("2025-01-31T23:59:59.999Z"),
            }),
          }),
        }),
      );
    });

    it("supports cursor-based pagination", async () => {
      prismaMock.alertEvent.findMany.mockResolvedValue([makeAlertEvent()] as never);

      await caller.listEvents({
        environmentId: "env-1",
        cursor: "evt-prev",
      });

      expect(prismaMock.alertEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: "evt-prev" },
          skip: 1,
        }),
      );
    });
  });

  // ─── acknowledgeEvent ──────────────────────────────────────────────────────

  describe("acknowledgeEvent", () => {
    it("acknowledges a firing alert event", async () => {
      const event = makeAlertEvent({ status: "firing" });
      prismaMock.alertEvent.findUnique.mockResolvedValue(event as never);
      prismaMock.alertEvent.update.mockResolvedValue({
        ...event,
        status: "acknowledged",
        acknowledgedAt: new Date(),
        acknowledgedBy: "test@test.com",
      } as never);

      const result = await caller.acknowledgeEvent({ alertEventId: "evt-1" });

      expect(result.status).toBe("acknowledged");
      expect(prismaMock.alertEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "evt-1" },
          data: expect.objectContaining({
            status: "acknowledged",
            acknowledgedBy: "test@test.com",
          }),
        }),
      );
    });

    it("throws NOT_FOUND for missing event", async () => {
      prismaMock.alertEvent.findUnique.mockResolvedValue(null);

      await expect(
        caller.acknowledgeEvent({ alertEventId: "evt-missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws BAD_REQUEST for non-firing event", async () => {
      prismaMock.alertEvent.findUnique.mockResolvedValue(
        makeAlertEvent({ status: "resolved" }) as never,
      );

      await expect(
        caller.acknowledgeEvent({ alertEventId: "evt-1" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ─── listCorrelationGroups ─────────────────────────────────────────────────

  describe("listCorrelationGroups", () => {
    it("returns correlation groups with preview events", async () => {
      const groups = [
        {
          id: "group-1",
          environmentId: "env-1",
          status: "firing",
          rootCauseEventId: "evt-1",
          rootCauseSuggestion: "Node offline",
          eventCount: 3,
          openedAt: new Date("2025-01-01"),
          closedAt: null,
          events: [makeAlertEvent()],
        },
      ];
      prismaMock.alertCorrelationGroup.findMany.mockResolvedValue(groups as never);

      const result = await caller.listCorrelationGroups({ environmentId: "env-1" });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].events).toHaveLength(1);
    });

    it("filters by status", async () => {
      prismaMock.alertCorrelationGroup.findMany.mockResolvedValue([] as never);

      await caller.listCorrelationGroups({
        environmentId: "env-1",
        status: "resolved",
      });

      expect(prismaMock.alertCorrelationGroup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "resolved",
          }),
        }),
      );
    });

    it("returns nextCursor when more items exist", async () => {
      const groups = Array.from({ length: 51 }, (_, i) => ({
        id: `group-${i}`,
        environmentId: "env-1",
        status: "firing",
        openedAt: new Date(),
        closedAt: null,
        events: [],
      }));
      prismaMock.alertCorrelationGroup.findMany.mockResolvedValue(groups as never);

      const result = await caller.listCorrelationGroups({
        environmentId: "env-1",
        limit: 50,
      });

      expect(result.items).toHaveLength(50);
      expect(result.nextCursor).toBe("group-50");
    });
  });

  // ─── getCorrelationGroup ───────────────────────────────────────────────────

  describe("getCorrelationGroup", () => {
    it("returns a correlation group with all events", async () => {
      const group = {
        id: "group-1",
        environmentId: "env-1",
        status: "firing",
        rootCauseEventId: "evt-1",
        rootCauseSuggestion: "Root cause",
        eventCount: 2,
        openedAt: new Date("2025-01-01"),
        closedAt: null,
        events: [makeAlertEvent(), makeAlertEvent({ id: "evt-2" })],
      };
      prismaMock.alertCorrelationGroup.findUnique.mockResolvedValue(group as never);

      const result = await caller.getCorrelationGroup({ id: "group-1" });

      expect(result.id).toBe("group-1");
      expect(result.events).toHaveLength(2);
    });

    it("throws NOT_FOUND for missing group", async () => {
      prismaMock.alertCorrelationGroup.findUnique.mockResolvedValue(null);

      await expect(
        caller.getCorrelationGroup({ id: "group-missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── acknowledgeGroup ──────────────────────────────────────────────────────

  describe("acknowledgeGroup", () => {
    it("acknowledges all firing events in a group", async () => {
      prismaMock.alertCorrelationGroup.findUnique.mockResolvedValue({
        id: "group-1",
        environmentId: "env-1",
        status: "firing",
        openedAt: new Date(),
        closedAt: null,
      } as never);
      prismaMock.alertEvent.updateMany.mockResolvedValue({ count: 3 } as never);

      const result = await caller.acknowledgeGroup({ groupId: "group-1" });

      expect(result).toEqual({ success: true });
      expect(prismaMock.alertEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            correlationGroupId: "group-1",
            status: "firing",
          },
          data: expect.objectContaining({
            status: "acknowledged",
            acknowledgedBy: "test@test.com",
          }),
        }),
      );
    });

    it("throws NOT_FOUND for missing group", async () => {
      prismaMock.alertCorrelationGroup.findUnique.mockResolvedValue(null);

      await expect(
        caller.acknowledgeGroup({ groupId: "group-missing" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
