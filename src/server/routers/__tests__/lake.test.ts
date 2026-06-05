import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t, isLakeEnabledMock, lakeQueryMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  return {
    t: initTRPC.context().create(),
    isLakeEnabledMock: vi.fn<() => boolean>(() => true),
    lakeQueryMock: vi.fn<(sql: string, params?: Record<string, unknown>) => Promise<unknown[]>>(),
  };
});

// Passthrough the tenancy middleware so we exercise handler logic directly;
// cross-org *gating* is covered by cross-org-access.test.ts.
vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) =>
      next({ ctx }),
    );
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    middleware: t.middleware,
  };
});

// Mock the A1 ClickHouse wrapper (per assignment) — the real lake-query service
// runs against it, so we assert the org-bound SQL the router ultimately issues.
vi.mock("@/server/services/lake/clickhouse", () => ({
  isLakeEnabled: isLakeEnabledMock,
  lakeQuery: lakeQueryMock,
}));

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

import { prisma } from "@/lib/prisma";
import { lakeRouter } from "@/server/routers/lake";
import { LAKE_MAX_LIMIT } from "@/server/services/lake/lake-query";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const sessionCtx = {
  session: { user: { id: "u1", email: "e@test", name: "n" } },
  userRole: "ADMIN" as const,
  teamId: "team-1",
};
const callerA = t.createCallerFactory(lakeRouter)({ ...sessionCtx, organizationId: "org-A" });
const callerB = t.createCallerFactory(lakeRouter)({ ...sessionCtx, organizationId: "org-B" });

const FROM = new Date("2026-06-01T00:00:00.000Z");
const TO = new Date("2026-06-02T00:00:00.000Z");

beforeEach(() => {
  mockReset(prismaMock);
  isLakeEnabledMock.mockReturnValue(true);
  lakeQueryMock.mockReset();
  lakeQueryMock.mockResolvedValue([]);
});

describe("lakeRouter.search", () => {
  it("sources the org scope from ctx.organizationId (bound param, never interpolated)", async () => {
    await callerA.search({ pipelineId: "p", from: FROM, to: TO });

    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(params?.orgId).toBe("org-A");
    expect(sql).toContain("organizationId = {orgId:String}");
    expect(sql).not.toContain("org-A");
  });

  it("isolates tenants — org A and org B callers bind different org params", async () => {
    await callerA.search({ pipelineId: "p", from: FROM, to: TO });
    await callerB.search({ pipelineId: "p", from: FROM, to: TO });

    expect(lakeQueryMock.mock.calls[0][1]?.orgId).toBe("org-A");
    expect(lakeQueryMock.mock.calls[1][1]?.orgId).toBe("org-B");
  });

  it("enforces row + statement caps through the service", async () => {
    await callerA.search({ pipelineId: "p", from: FROM, to: TO, limit: 9_999_999 });

    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(params?.limit).toBe(LAKE_MAX_LIMIT);
    expect(sql).toContain("max_execution_time");
    expect(sql).toContain("max_result_rows");
  });

  it("rejects a time window wider than the allowed max range", async () => {
    await expect(
      callerA.search({ pipelineId: "p", from: new Date("2000-01-01T00:00:00Z"), to: TO }),
    ).rejects.toThrow();
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });

  it("returns [] when the lake is disabled", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    await expect(callerA.search({ pipelineId: "p", from: FROM, to: TO })).resolves.toEqual([]);
  });
});

describe("lakeRouter.rawSearch (ADMIN)", () => {
  it("maps a disallowed raw filter to BAD_REQUEST", async () => {
    await expect(
      callerA.rawSearch({ pipelineId: "p", from: FROM, to: TO, where: "1=1; DROP TABLE x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(lakeQueryMock).not.toHaveBeenCalled();
  });

  it("runs a safe raw filter, still org-scoped via ctx", async () => {
    await callerA.rawSearch({ pipelineId: "p", from: FROM, to: TO, where: "host = 'db1'" });

    const [sql, params] = lakeQueryMock.mock.calls[0];
    expect(sql).toContain("AND (host = 'db1')");
    expect(sql).toContain("organizationId = {orgId:String}");
    expect(params?.orgId).toBe("org-A");
  });
});

describe("lakeRouter.listDatasets", () => {
  it("lists catalog datasets filtered by ctx.organizationId", async () => {
    prismaMock.lakeDataset.findMany.mockResolvedValue([] as never);

    await callerA.listDatasets({ teamId: "team-1" });

    expect(prismaMock.lakeDataset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-A" } }),
    );
  });
});

describe("lakeRouter.getSchema / fieldStats", () => {
  it("getSchema org-scopes the discovery query via ctx", async () => {
    await callerA.getSchema({ pipelineId: "p" });
    expect(lakeQueryMock.mock.calls[0][1]?.orgId).toBe("org-A");
  });

  it("fieldStats org-scopes the aggregation via ctx", async () => {
    await callerA.fieldStats({ pipelineId: "p", field: "severity", from: FROM, to: TO });
    expect(lakeQueryMock.mock.calls[0][1]?.orgId).toBe("org-A");
  });
});
