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
    denyInDemo: passthrough,
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

// ─── deploymentSummary procedure ────────────────────────────────────────────

describe("audit.deploymentSummary", () => {
  it("returns aggregated deployment stats from the last 24 hours", async () => {
    const entries = [
      makeAuditEntry({
        id: "a1",
        userId: "user-1",
        entityType: "Pipeline",
        entityId: "pipeline-1",
        metadata: { input: { pipelineId: "pipeline-1" } },
      }),
      makeAuditEntry({
        id: "a2",
        userId: "user-2",
        entityType: "Pipeline",
        entityId: "pipeline-2",
        metadata: { input: { pipelineId: "pipeline-2" } },
      }),
      makeAuditEntry({
        id: "a3",
        userId: "user-1",
        entityType: "Pipeline",
        entityId: "pipeline-1",
        metadata: { input: { pipelineId: "pipeline-1" } },
      }),
    ];
    prismaMock.auditLog.findMany.mockResolvedValueOnce(entries as never);

    const result = await caller.deploymentSummary();

    expect(result.deployCount).toBe(3);
    expect(result.uniqueDeployers).toBe(2);
    expect(result.affectedPipelines).toBe(2);
  });

  it("returns zeros when no deployments in the last 24 hours", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);

    const result = await caller.deploymentSummary();

    expect(result.deployCount).toBe(0);
    expect(result.uniqueDeployers).toBe(0);
    expect(result.affectedPipelines).toBe(0);
  });

  it("filters by DEPLOYMENT_ACTIONS and 24h time window", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);

    const before = Date.now();
    await caller.deploymentSummary();

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0] as Record<string, unknown>;
    const where = findManyCall.where as { action: unknown; createdAt: { gte: Date } };
    expect(where.action).toEqual({ in: [...DEPLOYMENT_ACTIONS] });
    // The gte date should be approximately 24 hours ago
    const expectedGte = new Date(before - 24 * 60 * 60 * 1000);
    expect(where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(expectedGte.getTime() - 1000);
    expect(where.createdAt.gte.getTime()).toBeLessThanOrEqual(before);
  });

  it("counts pipelines from DeployRequest metadata", async () => {
    const entry = makeAuditEntry({
      entityType: "DeployRequest",
      entityId: "deploy-req-1",
      metadata: { input: { pipelineId: "pipeline-99" } },
    });
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);

    const result = await caller.deploymentSummary();

    expect(result.affectedPipelines).toBe(1);
  });

  it("handles entries with null userId", async () => {
    const entry = makeAuditEntry({ userId: null });
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);

    const result = await caller.deploymentSummary();

    expect(result.deployCount).toBe(1);
    expect(result.uniqueDeployers).toBe(0);
  });
});

// ─── exportDeployments procedure ────────────────────────────────────────────

describe("audit.exportDeployments", () => {
  it("returns enriched deployment entries without cursor", async () => {
    const entry = makeAuditEntry();
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "My Pipeline" },
    ] as never);

    const result = await caller.exportDeployments({});

    expect(result.items).toHaveLength(1);
    expect(result.items[0].pipelineName).toBe("My Pipeline");
    expect(result.items[0].changelog).toBe("Initial deploy");
    // No cursor in export response
    expect((result as Record<string, unknown>).nextCursor).toBeUndefined();
  });

  it("applies pipelineId filter", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);

    await caller.exportDeployments({ pipelineId: "pipeline-5" });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    expect(andConditions.AND).toContainEqual({
      OR: [
        { entityType: "Pipeline", entityId: "pipeline-5" },
        { entityType: "DeployRequest", entityId: "pipeline-5" },
      ],
    });
  });

  it("applies date range filter", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);

    await caller.exportDeployments({
      startDate: "2025-03-01",
      endDate: "2025-03-31",
    });

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0];
    const andConditions = (findManyCall as Record<string, unknown>).where as { AND: Record<string, unknown>[] };
    const dateCondition = andConditions.AND.find(
      (c) => "createdAt" in c
    ) as { createdAt: { gte?: Date; lte?: Date } };
    expect(dateCondition).toBeDefined();
    expect(dateCondition.createdAt.gte).toEqual(new Date("2025-03-01"));
    expect(dateCondition.createdAt.lte).toEqual(new Date("2025-03-31"));
  });

  it("limits results to 10,000 rows", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);

    await caller.exportDeployments({});

    const findManyCall = prismaMock.auditLog.findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(findManyCall.take).toBe(10_000);
    // No cursor logic in export
    expect(findManyCall.cursor).toBeUndefined();
    expect(findManyCall.skip).toBeUndefined();
  });

  it("returns empty result when no matching entries exist", async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);

    const result = await caller.exportDeployments({});

    expect(result.items).toHaveLength(0);
    expect(prismaMock.pipeline.findMany).not.toHaveBeenCalled();
  });

  it("handles DeployRequest entity type entries in export", async () => {
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

    const result = await caller.exportDeployments({});

    expect(result.items[0].pipelineName).toBe("Staging Pipeline");
    expect(result.items[0].pipelineId).toBe("pipeline-2");
    expect(result.items[0].changelog).toBe("Staged deploy");
  });
});

// ─── DEPLOYMENT_ACTIONS constant ────────────────────────────────────────────

describe("DEPLOYMENT_ACTIONS", () => {
  it("includes staged rollout and auto-rollback actions", () => {
    expect(DEPLOYMENT_ACTIONS).toContain("deploy.staged_created");
    expect(DEPLOYMENT_ACTIONS).toContain("deploy.staged_broadened");
    expect(DEPLOYMENT_ACTIONS).toContain("deploy.staged_rolled_back");
    expect(DEPLOYMENT_ACTIONS).toContain("deploy.auto_rollback");
  });

  it("still includes all original deployment actions", () => {
    expect(DEPLOYMENT_ACTIONS).toContain("deploy.agent");
    expect(DEPLOYMENT_ACTIONS).toContain("deploy.from_version");
    expect(DEPLOYMENT_ACTIONS).toContain("deploy.undeploy");
    expect(DEPLOYMENT_ACTIONS).toContain("deploy.request_submitted");
    expect(DEPLOYMENT_ACTIONS).toContain("deployRequest.approved");
    expect(DEPLOYMENT_ACTIONS).toContain("deployRequest.deployed");
    expect(DEPLOYMENT_ACTIONS).toContain("deployRequest.rejected");
    expect(DEPLOYMENT_ACTIONS).toContain("deploy.cancel_request");
    expect(DEPLOYMENT_ACTIONS).toContain("pipeline.rollback");
  });
});

// ─── pushedNodeIds enrichment ───────────────────────────────────────────────

describe("audit.deployments pushedNodeIds enrichment", () => {
  it("resolves pushedNodeIds from metadata to node names", async () => {
    const entry = makeAuditEntry({
      action: "deploy.agent",
      metadata: {
        timestamp: "2025-01-01T00:00:00Z",
        input: { pipelineId: "pipeline-1", changelog: "Deploy" },
        pushedNodeIds: ["node-1", "node-2"],
      },
    });
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "My Pipeline" },
    ] as never);
    prismaMock.vectorNode.findMany.mockResolvedValueOnce([
      { id: "node-1", name: "us-east-1-prod" },
      { id: "node-2", name: "eu-west-1-prod" },
    ] as never);

    const result = await caller.deployments({});

    expect(result.items[0].pushedNodeNames).toEqual(["us-east-1-prod", "eu-west-1-prod"]);
  });

  it("falls back to node ID when node name is not found", async () => {
    const entry = makeAuditEntry({
      action: "deploy.agent",
      metadata: {
        timestamp: "2025-01-01T00:00:00Z",
        input: { pipelineId: "pipeline-1", changelog: "Deploy" },
        pushedNodeIds: ["node-1", "node-deleted"],
      },
    });
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "My Pipeline" },
    ] as never);
    prismaMock.vectorNode.findMany.mockResolvedValueOnce([
      { id: "node-1", name: "us-east-1-prod" },
    ] as never);

    const result = await caller.deployments({});

    expect(result.items[0].pushedNodeNames).toEqual(["us-east-1-prod", "node-deleted"]);
  });

  it("returns null pushedNodeNames when metadata has no pushedNodeIds", async () => {
    const entry = makeAuditEntry({
      action: "deploy.agent",
      metadata: {
        timestamp: "2025-01-01T00:00:00Z",
        input: { pipelineId: "pipeline-1", changelog: "Deploy" },
      },
    });
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "My Pipeline" },
    ] as never);

    const result = await caller.deployments({});

    expect(result.items[0].pushedNodeNames).toBeNull();
    expect(prismaMock.vectorNode.findMany).not.toHaveBeenCalled();
  });

  it("does not query VectorNode when no items have pushedNodeIds", async () => {
    const entry = makeAuditEntry({ metadata: null });
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "My Pipeline" },
    ] as never);

    await caller.deployments({});

    expect(prismaMock.vectorNode.findMany).not.toHaveBeenCalled();
  });

  it("batch-resolves node IDs across multiple audit entries", async () => {
    const entry1 = makeAuditEntry({
      id: "audit-1",
      action: "deploy.agent",
      metadata: {
        timestamp: "2025-01-01T00:00:00Z",
        input: { pipelineId: "pipeline-1", changelog: "Deploy 1" },
        pushedNodeIds: ["node-1"],
      },
    });
    const entry2 = makeAuditEntry({
      id: "audit-2",
      action: "deploy.from_version",
      metadata: {
        timestamp: "2025-01-02T00:00:00Z",
        input: { pipelineId: "pipeline-1", changelog: "Deploy 2" },
        pushedNodeIds: ["node-2", "node-3"],
      },
    });
    prismaMock.auditLog.findMany.mockResolvedValueOnce([entry1, entry2] as never);
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      { id: "pipeline-1", name: "My Pipeline" },
    ] as never);
    prismaMock.vectorNode.findMany.mockResolvedValueOnce([
      { id: "node-1", name: "node-alpha" },
      { id: "node-2", name: "node-beta" },
      { id: "node-3", name: "node-gamma" },
    ] as never);

    const result = await caller.deployments({});

    // Should batch all node IDs into a single query
    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledTimes(1);
    const nodeQuery = prismaMock.vectorNode.findMany.mock.calls[0][0] as Record<string, unknown>;
    const nodeWhere = nodeQuery.where as { id: { in: string[] } };
    expect(nodeWhere.id.in).toHaveLength(3);
    expect(nodeWhere.id.in).toContain("node-1");
    expect(nodeWhere.id.in).toContain("node-2");
    expect(nodeWhere.id.in).toContain("node-3");

    expect(result.items[0].pushedNodeNames).toEqual(["node-alpha"]);
    expect(result.items[1].pushedNodeNames).toEqual(["node-beta", "node-gamma"]);
  });
});
