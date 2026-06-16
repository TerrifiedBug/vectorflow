import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// Same hoisted tRPC harness as environment-lake-bucket.test.ts: capture the
// `withTeamAccess` role + `withAudit` wiring at router-construction time.
const { t, prismaHolder, auditCalls } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  return {
    t: initTRPC.context().create(),
    prismaHolder: {} as { mock?: DeepMockProxy<PrismaClient> },
    auditCalls: [] as Array<{ action: string; entity: string }>,
  };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (o: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: (role: string) => {
      const fn = ({ next, ctx }: { next: (o: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx });
      (fn as unknown as { _vfGateRole?: string })._vfGateRole = role;
      return t.middleware(fn);
    },
    requirePlatformOperator: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: (action: string, entity: string) => {
    auditCalls.push({ action, entity });
    return t.middleware(({ next, ctx }: { next: (o: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  },
}));

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  prismaHolder.mock = __pm;
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

// Run the tenant transaction body directly against the prisma mock (tx === mock).
vi.mock("@/lib/with-org-tx", () => ({
  withOrgTx: (_orgId: string, fn: (tx: unknown) => unknown) => fn(prismaHolder.mock),
}));

vi.mock("@/server/services/agent-token", () => ({
  generateEnrollmentToken: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { environmentRouter } from "@/server/routers/environment";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const caller = t.createCallerFactory(environmentRouter)({
  session: { user: { id: "user-1", email: "admin@test.com" } },
  userRole: "ADMIN",
  teamId: "team-1",
  organizationId: "default",
});

const appRouter = t.router({ environment: environmentRouter });

function gateRoleFor(path: string): string | undefined {
  const procs = (
    appRouter as unknown as {
      _def: { procedures: Record<string, { _def?: { middlewares?: unknown[] } }> };
    }
  )._def.procedures;
  for (const mw of procs[path]?._def?.middlewares ?? []) {
    const role = (mw as { _vfGateRole?: string })._vfGateRole;
    if (role) return role;
  }
  return undefined;
}

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

describe("environment.getLakeRetention", () => {
  it("returns the table defaults plus bounds when no policy exists", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default" } as never);
    prismaMock.lakeRetentionPolicy.findUnique.mockResolvedValue(null);

    const result = await caller.getLakeRetention({ environmentId: "env-1" });

    expect(result).toEqual({
      hotDays: 7,
      coldDays: 90,
      isDefault: true,
      bounds: { min: 1, max: 3650 },
    });
  });

  it("returns the per-env policy window when set", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default" } as never);
    prismaMock.lakeRetentionPolicy.findUnique.mockResolvedValue({ hotDays: 10, coldDays: 40 } as never);

    const result = await caller.getLakeRetention({ environmentId: "env-1" });

    expect(result.isDefault).toBe(false);
    expect(result.hotDays).toBe(10);
    expect(result.coldDays).toBe(40);
  });

  it("throws NOT_FOUND for a missing environment", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(null);
    await expect(caller.getLakeRetention({ environmentId: "ghost" })).rejects.toThrow(
      "Environment not found",
    );
  });
});

describe("environment.setLakeRetention", () => {
  it("upserts the policy and reports how many datasets were attached", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default", isSystem: false } as never);
    prismaMock.lakeRetentionPolicy.upsert.mockResolvedValue({ id: "pol-1" } as never);
    prismaMock.lakeDataset.updateMany.mockResolvedValue({ count: 4 } as never);

    const result = await caller.setLakeRetention({ environmentId: "env-1", hotDays: 5, coldDays: 30 });

    expect(result).toEqual({ success: true, attached: 4 });
    expect(prismaMock.lakeDataset.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "default", environmentId: "env-1" },
      data: { retentionPolicyId: "pol-1" },
    });
  });

  it("rejects an inverted window with BAD_REQUEST and writes nothing", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default", isSystem: false } as never);

    await expect(
      caller.setLakeRetention({ environmentId: "env-1", hotDays: 90, coldDays: 7 }),
    ).rejects.toThrow(/coldDays/);
    expect(prismaMock.lakeRetentionPolicy.upsert).not.toHaveBeenCalled();
  });

  it("rejects the system environment", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default", isSystem: true } as never);
    await expect(
      caller.setLakeRetention({ environmentId: "sys", hotDays: 7, coldDays: 90 }),
    ).rejects.toThrow();
    expect(prismaMock.lakeRetentionPolicy.upsert).not.toHaveBeenCalled();
  });
});

describe("environment.clearLakeRetention", () => {
  it("detaches datasets and deletes the policy", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default" } as never);
    prismaMock.lakeRetentionPolicy.findUnique.mockResolvedValue({ id: "pol-1" } as never);
    prismaMock.lakeDataset.updateMany.mockResolvedValue({ count: 2 } as never);

    const result = await caller.clearLakeRetention({ environmentId: "env-1" });

    expect(result).toEqual({ success: true, cleared: true, detached: 2 });
    expect(prismaMock.lakeRetentionPolicy.delete).toHaveBeenCalledWith({ where: { id: "pol-1" } });
  });
});

describe("tenancy + audit wiring", () => {
  it("gates getLakeRetention on VIEWER and set/clear on ADMIN", () => {
    expect(gateRoleFor("environment.getLakeRetention")).toBe("VIEWER");
    expect(gateRoleFor("environment.setLakeRetention")).toBe("ADMIN");
    expect(gateRoleFor("environment.clearLakeRetention")).toBe("ADMIN");
  });

  it("audits the set and clear mutations against the Environment entity", () => {
    expect(auditCalls).toContainEqual({ action: "environment.lake_retention_set", entity: "Environment" });
    expect(auditCalls).toContainEqual({ action: "environment.lake_retention_cleared", entity: "Environment" });
  });
});
