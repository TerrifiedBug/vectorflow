/**
 * Audit router — unit tests for core procedures:
 *   list, actions, entityTypes, users
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) =>
      next({ ctx }),
    );
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) =>
      next({ ctx }),
    ),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import { auditRouter } from "@/server/routers/audit";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(auditRouter)({
  session: { user: { id: "user-1" } },
});

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as never);
  prismaMock.teamMember.findMany.mockResolvedValue([]);
  vi.clearAllMocks();
});

// ── audit.list ─────────────────────────────────────────────────────────────────

describe("audit.list", () => {
  it("returns items and no nextCursor when results fit within the page size", async () => {
    const items = Array.from({ length: 3 }, (_, i) => ({
      id: `log-${i}`,
      action: "pipeline.create",
      entityType: "Pipeline",
      entityId: `pipe-${i}`,
      userId: "user-1",
      teamId: null,
      environmentId: null,
      metadata: null,
      createdAt: new Date(),
      user: { id: "user-1", name: "Alice", email: "alice@example.com" },
    }));

    prismaMock.auditLog.findMany.mockResolvedValue(items as never);

    const result = await caller.list({});

    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns nextCursor when there are more than 50 items", async () => {
    // Router fetches take+1 (51) to determine if there is a next page
    const items = Array.from({ length: 51 }, (_, i) => ({
      id: `log-${i}`,
      action: "pipeline.create",
      entityType: "Pipeline",
      entityId: `pipe-${i}`,
      userId: "user-1",
      teamId: null,
      environmentId: null,
      metadata: null,
      createdAt: new Date(),
      user: null,
    }));

    prismaMock.auditLog.findMany.mockResolvedValue(items as never);

    const result = await caller.list({});

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe("log-50");
  });

  it("applies action filter to the Prisma query", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.list({ action: "pipeline.delete" });

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ action: "pipeline.delete" }]),
        }),
      }),
    );
  });

  it("applies userId filter to the Prisma query", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.list({ userId: "user-99" });

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ userId: "user-99" }]),
        }),
      }),
    );
  });

  it("applies entityTypes filter when provided", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.list({ entityTypes: ["Pipeline", "DeployRequest"] });

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { entityType: { in: ["Pipeline", "DeployRequest"] } },
          ]),
        }),
      }),
    );
  });

  it("applies teamId filter when teamId is provided", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.list({ teamId: "team-1" });

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ teamId: "team-1" }]),
        }),
      }),
    );
  });

  it("applies date range filter when startDate and endDate provided", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.list({
      startDate: "2024-01-01T00:00:00Z",
      endDate: "2024-01-31T23:59:59Z",
    });

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              createdAt: expect.objectContaining({
                gte: expect.any(Date),
                lte: expect.any(Date),
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it("applies search filter as OR across action, entityType, entityId", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.list({ search: "pipeline" });

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { action: { contains: "pipeline", mode: "insensitive" } },
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it("excludes SCIM provisioning actions from the default view", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.list({});

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ NOT: { action: { startsWith: "scim." } } }],
        },
      }),
    );
  });

  it("includes SCIM entries when filtering by a SCIM entity type", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.list({ entityTypes: ["ScimUser", "ScimGroup"] });

    const call = prismaMock.auditLog.findMany.mock.calls[0]?.[0];
    const conditions = (call as { where: { AND: unknown[] } }).where.AND;
    // No NOT-startsWith-scim condition should be present
    expect(conditions).not.toContainEqual({
      NOT: { action: { startsWith: "scim." } },
    });
  });

  it("includes SCIM entries when explicitly filtering by a scim.* action", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.list({ action: "scim.user_created" });

    const call = prismaMock.auditLog.findMany.mock.calls[0]?.[0];
    const conditions = (call as { where: { AND: unknown[] } }).where.AND;
    expect(conditions).not.toContainEqual({
      NOT: { action: { startsWith: "scim." } },
    });
  });

  it("passes cursor for pagination", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.list({ cursor: "log-42" });

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "log-42" },
        skip: 1,
      }),
    );
  });
});

// ── audit.actions ─────────────────────────────────────────────────────────────

describe("audit.actions", () => {
  it("returns distinct action values as a sorted string array", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      { action: "pipeline.create" },
      { action: "pipeline.delete" },
      { action: "deploy.agent" },
    ] as never);

    const result = await caller.actions();

    expect(result).toEqual(["pipeline.create", "pipeline.delete", "deploy.agent"]);
  });

  it("returns empty array when no audit logs exist", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    const result = await caller.actions();

    expect(result).toEqual([]);
  });

  it("queries with distinct and orderBy on action", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.actions();

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { action: true },
        distinct: ["action"],
        orderBy: { action: "asc" },
      }),
    );
  });
});

// ── audit.entityTypes ─────────────────────────────────────────────────────────

describe("audit.entityTypes", () => {
  it("returns distinct entity type values as a string array", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      { entityType: "Pipeline" },
      { entityType: "DeployRequest" },
    ] as never);

    const result = await caller.entityTypes();

    expect(result).toEqual(["Pipeline", "DeployRequest"]);
  });

  it("returns empty array when no audit logs exist", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    const result = await caller.entityTypes();

    expect(result).toEqual([]);
  });

  it("queries with distinct and orderBy on entityType", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.entityTypes();

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { entityType: true },
        distinct: ["entityType"],
        orderBy: { entityType: "asc" },
      }),
    );
  });
});

// ── audit.users ────────────────────────────────────────────────────────────────

describe("audit.users", () => {
  it("returns a list of distinct non-null users from audit logs", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      { user: { id: "user-1", name: "Alice", email: "alice@example.com" } },
      { user: { id: "user-2", name: "Bob", email: "bob@example.com" } },
    ] as never);

    const result = await caller.users();

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "user-1", name: "Alice" });
    expect(result[1]).toMatchObject({ id: "user-2", name: "Bob" });
  });

  it("filters out null user entries", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      { user: { id: "user-1", name: "Alice", email: "alice@example.com" } },
      { user: null },
    ] as never);

    const result = await caller.users();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "user-1" });
  });

  it("returns empty array when no users have audit entries", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    const result = await caller.users();

    expect(result).toEqual([]);
  });

  it("queries only logs with non-null userId and uses distinct", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);

    await caller.users();

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ userId: { not: null } }] },
        distinct: ["userId"],
      }),
    );
  });
});
