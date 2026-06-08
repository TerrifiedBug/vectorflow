/**
 * fleet.configDriftReport — running-vs-desired config drift.
 *
 * Uses the REAL `@/trpc/init` authorization middleware (no passthrough) so the
 * same file exercises both:
 *   1. classification — drifted when the agent-reported (running) checksum
 *      differs from the cached desired checksum, in-sync when equal, unknown
 *      when either side is absent (mirrors `getConfigDrift`); and
 *   2. RBAC gating — `withTeamAccess("VIEWER")` blocks non-members (FORBIDDEN)
 *      and `protectedProcedure` blocks unauthenticated callers (UNAUTHORIZED).
 *
 * The desired checksum is seeded via setExpectedChecksum into the shared store
 * (Redis when configured, in-memory cache otherwise — here the cache), exactly
 * how the config endpoint records it and getExpectedChecksums reads it.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { testT } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  return { testT: initTRPC.context().create() };
});

// Real `@/trpc/init` pulls in auth + next/headers at module load.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    testT.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) =>
      next({ ctx }),
    ),
}));

// fleet.ts top-level service imports — mocked so the module loads without their
// heavy transitive deps (e.g. ClickHouse via fleet-data). drift-metrics is left
// REAL so the expected-checksum cache behaves as in production.
vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: { isConnected: vi.fn(() => false), notify: vi.fn() },
}));
vi.mock("@/server/services/push-broadcast", () => ({ relayPush: vi.fn() }));
vi.mock("@/server/services/version-check", () => ({ checkDevAgentVersion: vi.fn() }));
vi.mock("@/server/services/fleet-data", () => ({
  getFleetOverview: vi.fn(),
  getVolumeTrend: vi.fn(),
  getNodeThroughput: vi.fn(),
  getNodeCapacity: vi.fn(),
  getCpuHeatmap: vi.fn(),
  getDataLoss: vi.fn(),
  getMatrixThroughput: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { fleetRouter } from "@/server/routers/fleet";
import {
  setExpectedChecksum,
  clearExpectedChecksumCache,
} from "@/server/services/drift-metrics";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const baseCtx = {
  session: { user: { id: "user-1" } },
  ipAddress: null,
  organizationId: "default",
  orgMemberRole: null,
};
const caller = fleetRouter.createCaller(baseCtx);
const unauthCaller = fleetRouter.createCaller({ ...baseCtx, session: null });

const REPORTED = new Date("2026-06-08T10:00:00.000Z");

function statusRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    nodeId: "node-1",
    node: { name: "alpha" },
    pipelineId: "pipe-1",
    pipeline: { name: "ingest" },
    status: "RUNNING",
    configChecksum: "desired-aaa",
    lastUpdated: REPORTED,
    ...overrides,
  };
}

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
  clearExpectedChecksumCache();
});

describe("fleet.configDriftReport — classification", () => {
  beforeEach(() => {
    // withTeamAccess: env → teamId, then org-wide-admin bypass (OWNER).
    prismaMock.environment.findUnique.mockResolvedValue({ teamId: "team-1" } as never);
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "OWNER" } as never);
  });

  it("classifies running vs desired per node-pipeline (in-sync, drifted, unknown)", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      // running == desired → in-sync
      statusRow({ nodeId: "node-1", node: { name: "alpha" }, configChecksum: "desired-aaa" }),
      // running != desired → drifted
      statusRow({ nodeId: "node-2", node: { name: "bravo" }, configChecksum: "stale-zzz" }),
      // no reported checksum (older agent) → unknown
      statusRow({
        nodeId: "node-3",
        node: { name: "charlie" },
        pipelineId: "pipe-2",
        pipeline: { name: "egress" },
        configChecksum: null,
      }),
      // reported but no desired cached → unknown
      statusRow({
        nodeId: "node-4",
        node: { name: "delta" },
        pipelineId: "pipe-3",
        pipeline: { name: "audit" },
        status: "STOPPED",
        configChecksum: "orphan-checksum",
      }),
    ] as never);

    setExpectedChecksum("pipe-1", "desired-aaa");
    setExpectedChecksum("pipe-2", "desired-bbb");

    const result = await caller.configDriftReport({ environmentId: "env-1" });

    expect(result.summary).toEqual({ total: 4, inSync: 1, drifted: 1, unknown: 2 });
    expect(
      result.nodes.map((n) => ({ nodeId: n.nodeId, drift: n.drift })),
    ).toEqual([
      { nodeId: "node-1", drift: "in_sync" },
      { nodeId: "node-2", drift: "drifted" },
      { nodeId: "node-3", drift: "unknown" },
      { nodeId: "node-4", drift: "unknown" },
    ]);

    // Drifted row exposes presence only (raw secret-derived checksums are never
    // sent to the client), plus enough context for the UI.
    const drifted = result.nodes.find((n) => n.nodeId === "node-2")!;
    expect(drifted).toMatchObject({
      pipelineName: "ingest",
      status: "RUNNING",
      hasRunning: true,
      hasDesired: true,
      lastReportedAt: REPORTED,
    });
    expect("runningChecksum" in drifted).toBe(false);
    expect("desiredChecksum" in drifted).toBe(false);

    // In-sync row: both present.
    const inSync = result.nodes.find((n) => n.nodeId === "node-1")!;
    expect(inSync.hasRunning).toBe(true);
    expect(inSync.hasDesired).toBe(true);

    // Older agent (no running checksum) still reflects that the desired checksum
    // is cached, so the UI shows "— / reported" not "— / —".
    const olderAgent = result.nodes.find((n) => n.nodeId === "node-3")!;
    expect(olderAgent.hasRunning).toBe(false);
    expect(olderAgent.hasDesired).toBe(true);
  });

  it("drops stale statuses whose node no longer matches the pipeline selector", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
      statusRow({
        nodeId: "node-1",
        node: { name: "alpha", labels: { tier: "edge" } },
        pipeline: { name: "ingest", nodeSelector: { tier: "edge" } },
        configChecksum: "sum-1",
      }),
      // node labels no longer satisfy the pipeline's selector → stale, excluded
      statusRow({
        nodeId: "node-2",
        pipelineId: "pipe-2",
        node: { name: "bravo", labels: { tier: "core" } },
        pipeline: { name: "egress", nodeSelector: { tier: "edge" } },
        configChecksum: "sum-2",
      }),
    ] as never);
    setExpectedChecksum("pipe-1", "sum-1");
    setExpectedChecksum("pipe-2", "sum-2");

    const result = await caller.configDriftReport({ environmentId: "env-1" });
    expect(result.summary.total).toBe(1);
    expect(result.nodes.map((n) => n.nodeId)).toEqual(["node-1"]);
  });

  it("scopes the query to the caller's organization and environment", async () => {
    prismaMock.nodePipelineStatus.findMany.mockResolvedValue([] as never);

    await caller.configDriftReport({ environmentId: "env-1" });

    expect(prismaMock.nodePipelineStatus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          node: { environmentId: "env-1", organizationId: "default" },
          pipeline: { isDraft: false, deployedAt: { not: null }, pausedAt: null },
        },
      }),
    );
  });
});

describe("fleet.configDriftReport — RBAC gating", () => {
  it("rejects non-members of the environment's team with FORBIDDEN", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ teamId: "team-2" } as never);
    prismaMock.orgMember.findUnique.mockResolvedValue(null); // not an org-wide admin
    prismaMock.teamMember.findUnique.mockResolvedValue(null); // not a team member

    await expect(
      caller.configDriftReport({ environmentId: "env-2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(prismaMock.nodePipelineStatus.findMany).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    await expect(
      unauthCaller.configDriftReport({ environmentId: "env-1" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(prismaMock.nodePipelineStatus.findMany).not.toHaveBeenCalled();
  });
});
