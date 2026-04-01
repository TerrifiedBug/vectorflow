import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── vi.hoisted so `t` is available inside vi.mock factories ────────────────

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

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import { auditRouter } from "@/server/routers/audit";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(auditRouter)({});

beforeEach(() => {
  mockReset(prismaMock);
});

// ─── helpers ────────────────────────────────────────────────────────────────

function makeAuditEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "audit-1",
    userId: overrides.userId ?? "user-1",
    action: overrides.action ?? "pipeline.created",
    entityType: overrides.entityType ?? "Pipeline",
    entityId: overrides.entityId ?? "pipeline-1",
    diff: null,
    metadata: overrides.metadata ?? { input: { name: "My Pipeline" } },
    ipAddress: overrides.ipAddress ?? "10.0.0.1",
    userEmail: "test@example.com",
    userName: "Test User",
    teamId: overrides.teamId ?? "team-1",
    environmentId: overrides.environmentId ?? "env-1",
    createdAt: overrides.createdAt ?? new Date("2025-06-01T12:00:00Z"),
    user: overrides.user ?? { id: "user-1", name: "Test User", email: "test@example.com" },
    ...overrides,
  };
}

// ─── exportAuditLog procedure ──────────────────────────────────────────────

describe("audit.exportAuditLog", () => {
  it("returns items and totalCount", async () => {
    const entry = makeAuditEntry();
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.auditLog.count.mockResolvedValueOnce(1);

    const result = await caller.exportAuditLog({});

    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(1);
  });

  it("limits results to 10,000 rows", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.auditLog.count.mockResolvedValueOnce(0);

    await caller.exportAuditLog({});

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(findManyCall.take).toBe(10_000);
    // No cursor logic in export
    expect(findManyCall.cursor).toBeUndefined();
  });

  it("applies action filter", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.auditLog.count.mockResolvedValueOnce(0);

    await caller.exportAuditLog({ action: "deploy.agent" });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    expect(andConditions.AND).toContainEqual({ action: "deploy.agent" });
  });

  it("applies userId filter", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.auditLog.count.mockResolvedValueOnce(0);

    await caller.exportAuditLog({ userId: "user-99" });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    expect(andConditions.AND).toContainEqual({ userId: "user-99" });
  });

  it("applies entityTypes filter", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.auditLog.count.mockResolvedValueOnce(0);

    await caller.exportAuditLog({ entityTypes: ["Pipeline", "Team"] });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    expect(andConditions.AND).toContainEqual({
      entityType: { in: ["Pipeline", "Team"] },
    });
  });

  it("applies date range filter", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.auditLog.count.mockResolvedValueOnce(0);

    await caller.exportAuditLog({
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    const dateCondition = andConditions.AND.find(
      (c) => "createdAt" in c,
    ) as { createdAt: { gte?: Date; lte?: Date } };
    expect(dateCondition).toBeDefined();
    expect(dateCondition.createdAt.gte).toEqual(new Date("2025-01-01"));
    expect(dateCondition.createdAt.lte).toEqual(new Date("2025-06-30"));
  });

  it("applies search filter", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.auditLog.count.mockResolvedValueOnce(0);

    await caller.exportAuditLog({ search: "deploy" });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    const searchCondition = andConditions.AND.find(
      (c) => "OR" in c,
    ) as { OR: Record<string, unknown>[] };
    expect(searchCondition).toBeDefined();
    expect(searchCondition.OR).toHaveLength(3);
  });

  it("applies teamId filter with OR null", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.auditLog.count.mockResolvedValueOnce(0);

    await caller.exportAuditLog({ teamId: "team-5" });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    expect(andConditions.AND).toContainEqual({
      OR: [{ teamId: "team-5" }, { teamId: null }],
    });
  });

  it("includes user relation in results", async () => {
    const entry = makeAuditEntry();
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.auditLog.count.mockResolvedValueOnce(1);

    const result = await caller.exportAuditLog({});

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(findManyCall.include).toHaveProperty("user");
    expect(result.items[0].user).toEqual({
      id: "user-1",
      name: "Test User",
      email: "test@example.com",
    });
  });

  it("returns empty result when no entries exist", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.auditLog.count.mockResolvedValueOnce(0);

    const result = await caller.exportAuditLog({});

    expect(result.items).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });
});
