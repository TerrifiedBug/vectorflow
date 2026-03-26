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
import { DEPLOYMENT_ACTIONS } from "@/server/routers/audit";

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
    action: overrides.action ?? "deploy.agent",
    entityType: overrides.entityType ?? "Pipeline",
    entityId: overrides.entityId ?? "pipeline-1",
    diff: null,
    metadata: overrides.metadata ?? {
      timestamp: "2025-01-01T00:00:00Z",
      input: { pipelineId: "pipeline-1", changelog: "Initial deploy" },
    },
    ipAddress: null,
    userEmail: "test@example.com",
    userName: "Test User",
    teamId: null,
    environmentId: null,
    createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00Z"),
    user: overrides.user ?? { id: "user-1", name: "Test User", email: "test@example.com" },
    ...overrides,
  };
}

// ─── deployments procedure ──────────────────────────────────────────────────

describe("audit.deployments", () => {
  it("returns deployment audit entries with enriched pipeline data", async () => {
    const entry = makeAuditEntry();
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "My Pipeline" },
    ] as never);

    const result = await caller.deployments({});

    expect(result.items).toHaveLength(1);
    expect(result.items[0].pipelineName).toBe("My Pipeline");
    expect(result.items[0].pipelineId).toBe("pipeline-1");
    expect(result.items[0].changelog).toBe("Initial deploy");
    expect(result.nextCursor).toBeUndefined();
  });

  it("filters by deployment actions only", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);

    await caller.deployments({});

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    expect(andConditions.AND[0]).toEqual({
      action: { in: [...DEPLOYMENT_ACTIONS] },
    });
  });

  it("applies pipelineId filter", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);

    await caller.deployments({ pipelineId: "pipeline-99" });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    expect(andConditions.AND).toContainEqual({
      OR: [
        { entityType: "Pipeline", entityId: "pipeline-99" },
        { entityType: "DeployRequest", entityId: "pipeline-99" },
      ],
    });
  });

  it("applies date range filter", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);

    await caller.deployments({
      startDate: "2025-01-01",
      endDate: "2025-01-31",
    });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    const dateCondition = andConditions.AND.find(
      (c) => "createdAt" in c
    ) as { createdAt: { gte?: Date; lte?: Date } };
    expect(dateCondition).toBeDefined();
    expect(dateCondition.createdAt.gte).toEqual(new Date("2025-01-01"));
    expect(dateCondition.createdAt.lte).toEqual(new Date("2025-01-31"));
  });

  it("applies startDate only filter", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);

    await caller.deployments({ startDate: "2025-06-01" });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    const dateCondition = andConditions.AND.find(
      (c) => "createdAt" in c
    ) as { createdAt: { gte?: Date; lte?: Date } };
    expect(dateCondition.createdAt.gte).toEqual(new Date("2025-06-01"));
    expect(dateCondition.createdAt.lte).toBeUndefined();
  });

  it("returns empty result when no deployment entries exist", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);

    const result = await caller.deployments({});

    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeUndefined();
    // Should not query pipelines when no items
    expect(prismaMock.pipeline.findMany).not.toHaveBeenCalled();
  });

  it("handles cursor-based pagination", async () => {
    // Return 51 items (take=50 + 1 extra) to trigger nextCursor
    const items = Array.from({ length: 51 }, (_, i) =>
      makeAuditEntry({ id: `audit-${i}` })
    );
    prismaMock.auditLog.findMany.mockResolvedValueOnce(items as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "My Pipeline" },
    ] as never);

    const result = await caller.deployments({});

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe("audit-50");
  });

  it("uses cursor skip when cursor is provided", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([] as never);

    await caller.deployments({ cursor: "cursor-id" });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(findManyCall.cursor).toEqual({ id: "cursor-id" });
    expect(findManyCall.skip).toBe(1);
  });

  it("extracts version info from metadata", async () => {
    const entry = makeAuditEntry({
      action: "deploy.from_version",
      metadata: {
        timestamp: "2025-01-01T00:00:00Z",
        input: { pipelineId: "pipeline-1", sourceVersionId: "v-1", newVersion: 3 },
      },
    });
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "My Pipeline" },
    ] as never);

    const result = await caller.deployments({});

    expect(result.items[0].versionInfo).toBe("3");
  });

  it("handles DeployRequest entity type entries", async () => {
    const entry = makeAuditEntry({
      action: "deploy.request_submitted",
      entityType: "DeployRequest",
      entityId: "deploy-req-1",
      metadata: {
        timestamp: "2025-01-01T00:00:00Z",
        input: { pipelineId: "pipeline-2", changelog: "Staged deploy" },
      },
    });
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-2", name: "Staging Pipeline" },
    ] as never);

    const result = await caller.deployments({});

    expect(result.items[0].pipelineName).toBe("Staging Pipeline");
    expect(result.items[0].pipelineId).toBe("pipeline-2");
    expect(result.items[0].changelog).toBe("Staged deploy");
  });

  it("handles entries with missing metadata gracefully", async () => {
    const entry = makeAuditEntry({ metadata: null });
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "My Pipeline" },
    ] as never);

    const result = await caller.deployments({});

    expect(result.items[0].pipelineName).toBe("My Pipeline");
    expect(result.items[0].versionInfo).toBeNull();
    expect(result.items[0].changelog).toBeNull();
  });
});

// ─── deploymentPipelines procedure ──────────────────────────────────────────

describe("audit.deploymentPipelines", () => {
  it("returns distinct pipelines with deployment audit entries", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([
      { entityId: "pipeline-1" },
      { entityId: "pipeline-2" },
    ] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "Alpha Pipeline" },
      { id: "pipeline-2", name: "Beta Pipeline" },
    ] as never);

    const result = await caller.deploymentPipelines();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "pipeline-1", name: "Alpha Pipeline" });
    expect(result[1]).toEqual({ id: "pipeline-2", name: "Beta Pipeline" });
  });

  it("returns empty array when no deployment audit entries exist", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);

    const result = await caller.deploymentPipelines();

    expect(result).toEqual([]);
    expect(prismaMock.pipeline.findMany).not.toHaveBeenCalled();
  });

  it("queries only deployment actions for Pipeline entity type", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);

    await caller.deploymentPipelines();

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0] as Record<string, unknown>;
    const where = findManyCall.where as Record<string, unknown>;
    expect(where.action).toEqual({ in: [...DEPLOYMENT_ACTIONS] });
    expect(where.entityType).toBe("Pipeline");
  });
});
