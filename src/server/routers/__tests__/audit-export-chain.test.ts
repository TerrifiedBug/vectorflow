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
    t.middleware(
      ({
        next,
        ctx,
      }: {
        next: (opts: { ctx: unknown }) => unknown;
        ctx: unknown;
      }) => next({ ctx }),
    );
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requirePlatformOperator: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { prisma } from "@/lib/prisma";
import { auditRouter } from "@/server/routers/audit";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const callerFactory = t.createCallerFactory(auditRouter);

function caller(opts?: {
  isOrgAdmin?: boolean;
  teamIds?: string[];
  organizationId?: string;
}) {
  prismaMock.orgMember.findUnique.mockResolvedValue(
    opts?.isOrgAdmin !== false ? ({ role: "OWNER" } as never) : null,
  );
  prismaMock.teamMember.findMany.mockResolvedValue(
    (opts?.teamIds ?? []).map((teamId) => ({ teamId })) as never,
  );
  return callerFactory({
    session: { user: { id: "user-1", email: "u@example.test", name: "U" } },
    organizationId: opts?.organizationId ?? "org-a",
  });
}

beforeEach(() => {
  mockReset(prismaMock);
});

function makeChainRow(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "row-1",
    organizationId: overrides.organizationId ?? "org-a",
    userId: "user-1",
    action: overrides.action ?? "pipeline.created",
    entityType: "Pipeline",
    entityId: "pipeline-1",
    diff: null,
    metadata: null,
    ipAddress: "10.0.0.1",
    userEmail: "u@example.test",
    userName: "U",
    teamId: overrides.teamId ?? "team-1",
    environmentId: "env-1",
    createdAt:
      overrides.createdAt ?? new Date("2026-05-17T12:00:00Z"),
    prevHash: overrides.prevHash ?? "prev-hash",
    hash: overrides.hash ?? "this-hash",
    ...overrides,
  };
}

describe("audit.exportChain", () => {
  it("returns the envelope JSON + rowCount for a super-admin caller", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      makeChainRow({ id: "r1", prevHash: "g", hash: "h1" }),
      makeChainRow({ id: "r2", prevHash: "h1", hash: "h2" }),
    ] as never);

    const result = await caller().exportChain();
    expect(result.rowCount).toBe(2);
    expect(result.partial).toBe(false);
    const parsed = JSON.parse(result.envelope);
    expect(parsed.verifierVersion).toBe(1);
    expect(parsed.organizationId).toBe("org-a");
    expect(parsed.rows).toHaveLength(2);
  });

  it("filters by organizationId AND non-null hash (excludes legacy rows)", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([] as never);
    await caller({ organizationId: "org-b" }).exportChain();
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { organizationId: "org-b" },
            { hash: { not: null } },
          ]),
        }),
      }),
    );
  });

  it("emits partial:true for a team-scoped (non-super-admin) caller", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([] as never);
    const result = await caller({
      isOrgAdmin: false,
      teamIds: ["team-1"],
    }).exportChain();
    expect(result.partial).toBe(true);
  });

  it("emits partial:false when caller is super-admin (full org view)", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([] as never);
    const result = await caller({ isOrgAdmin: true }).exportChain();
    expect(result.partial).toBe(false);
  });

  it("orders rows by createdAt ascending and caps at 50k", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([] as never);
    await caller().exportChain();
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "asc" },
        take: 50_000,
      }),
    );
  });
});
