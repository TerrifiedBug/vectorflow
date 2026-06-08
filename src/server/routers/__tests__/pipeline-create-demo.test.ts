import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import type * as UtilsModule from "@/lib/utils";

// `prismaHolder` lets the hoisted `enforceQuota` mock reach the same prisma
// mock the SUT uses, so the quota callback runs against it (tx === mock).
const { t, prismaHolder } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  return {
    t: initTRPC.context().create(),
    prismaHolder: {} as { mock?: DeepMockProxy<PrismaClient> },
  };
});

// withTeamAccess tags the middleware it returns with the role it guards, so
// `gateRoleFor` can assert the procedure is gated without exercising the real
// (separately-tested) team-access enforcement.
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
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (o: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  prismaHolder.mock = __pm;
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

// Run the quota-gated create callback directly against the prisma mock. Quota
// mechanics are covered by the quotas service's own tests.
vi.mock("@/server/services/quotas-trpc", () => ({
  enforceQuota: (_org: string, _quota: string, create: (tx: unknown) => unknown) =>
    create(prismaHolder.mock),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn((_type: unknown, config: unknown) => config),
}));

vi.mock("@/server/services/system-environment", () => ({
  getOrCreateSystemEnvironment: vi.fn(),
}));

vi.mock("@/server/services/pipeline-graph", () => ({
  promotePipeline: vi.fn(),
  detectConfigChanges: vi.fn(),
  listPipelinesForEnvironment: vi.fn(),
  saveGraphComponents: vi.fn(),
}));

vi.mock("@/server/services/copy-pipeline-graph", () => ({
  copyPipelineGraph: vi.fn(),
}));

vi.mock("@/server/services/git-sync", () => ({
  gitSyncDeletePipeline: vi.fn(),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof UtilsModule>();
  return {
    ...actual,
    generateId: vi.fn(() => "generated-id"),
  };
});

import { prisma } from "@/lib/prisma";
import { generateId } from "@/lib/utils";
import { pipelineCrudRouter } from "@/server/routers/pipeline-crud";
import { saveGraphComponents } from "@/server/services/pipeline-graph";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const ctx = {
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
  organizationId: "org-1",
};

const caller = t.createCallerFactory(pipelineCrudRouter)(ctx);

// Wrap the sub-router so its procedures surface under dotted paths in
// `_def.procedures`, retaining the middleware instances tagged above.
const appRouter = t.router({ pipeline: pipelineCrudRouter });

/** Role guarding a procedure, read from its captured withTeamAccess gate. */
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

describe("pipelineCrudRouter.createDemoPipeline", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("creates a draft pipeline scoped to the environment's org + environment", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1", organizationId: "org-1" } as never);
    prismaMock.pipeline.create.mockResolvedValue({ id: "demo-1", name: "Demo logs pipeline" } as never);
    vi.mocked(saveGraphComponents).mockResolvedValue({} as never);

    const result = await caller.createDemoPipeline({ environmentId: "env-1" });

    expect(prismaMock.pipeline.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Demo logs pipeline",
          environmentId: "env-1",
          organizationId: "org-1",
          globalConfig: { log_level: "info" },
          createdById: "user-1",
          updatedById: "user-1",
        }),
      }),
    );
    expect(result).toEqual({ id: "demo-1", name: "Demo logs pipeline" });
  });

  it("persists the demo_logs → remap → blackhole graph via saveGraphComponents", async () => {
    vi.mocked(generateId)
      .mockReturnValueOnce("id-source")
      .mockReturnValueOnce("id-transform")
      .mockReturnValueOnce("id-sink");
    prismaMock.environment.findUnique.mockResolvedValue({ id: "env-1", organizationId: "org-1" } as never);
    prismaMock.pipeline.create.mockResolvedValue({ id: "demo-1", name: "Demo logs pipeline" } as never);
    vi.mocked(saveGraphComponents).mockResolvedValue({} as never);

    await caller.createDemoPipeline({ environmentId: "env-1" });

    expect(saveGraphComponents).toHaveBeenCalledOnce();
    const [, params] = vi.mocked(saveGraphComponents).mock.calls[0]!;
    expect(params.pipelineId).toBe("demo-1");
    expect(params.userId).toBe("user-1");

    // 3 nodes: correct componentTypes, kinds, and reused seed configs/VRL.
    expect(params.nodes).toEqual([
      expect.objectContaining({
        id: "id-source",
        componentKey: "demo_in",
        componentType: "demo_logs",
        kind: "SOURCE",
        config: { interval: 1, format: "json" },
      }),
      expect.objectContaining({
        id: "id-transform",
        componentKey: "remap",
        componentType: "remap",
        kind: "TRANSFORM",
        config: { source: '.env = "development"' },
      }),
      expect.objectContaining({
        id: "id-sink",
        componentKey: "blackhole",
        componentType: "blackhole",
        kind: "SINK",
        config: { print_interval_secs: 60 },
      }),
    ]);

    // 2 edges chaining source → transform → sink by generated node id.
    expect(params.edges).toEqual([
      { sourceNodeId: "id-source", targetNodeId: "id-transform" },
      { sourceNodeId: "id-transform", targetNodeId: "id-sink" },
    ]);
  });

  it("throws NOT_FOUND when the environment does not exist", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(null as never);

    await expect(caller.createDemoPipeline({ environmentId: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(prismaMock.pipeline.create).not.toHaveBeenCalled();
    expect(saveGraphComponents).not.toHaveBeenCalled();
  });

  it("is gated behind withTeamAccess(EDITOR) — tenant access required", () => {
    expect(gateRoleFor("pipeline.createDemoPipeline")).toBe("EDITOR");
  });
});
