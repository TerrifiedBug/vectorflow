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
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
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
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: { isConnected: vi.fn(() => false), notify: vi.fn() },
}));

vi.mock("@/server/services/version-check", () => ({
  checkDevAgentVersion: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { fleetRouter } from "@/server/routers/fleet";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(fleetRouter)({
  session: { user: { id: "user-1" } },
});

function makeNode(overrides: Partial<{
  id: string;
  name: string;
  host: string;
  status: string;
  labels: Record<string, string>;
}>) {
  return {
    id: overrides.id ?? "node-1",
    name: overrides.name ?? "node-1",
    host: overrides.host ?? "10.0.0.1",
    apiPort: 8686,
    environmentId: "env-1",
    status: overrides.status ?? "HEALTHY",
    labels: overrides.labels ?? {},
    lastSeen: new Date(),
    metadata: null,
    nodeTokenHash: null,
    enrolledAt: new Date(),
    lastHeartbeat: new Date(),
    agentVersion: "1.0.0",
    vectorVersion: "0.40.0",
    os: "linux",
    deploymentMode: "STANDALONE",
    pendingAction: null,
    lastUpdateError: null,
    maintenanceMode: false,
    maintenanceModeAt: null,
    createdAt: new Date(),
    environment: { id: "env-1", name: "Production" },
  };
}

describe("fleet.list", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    // Default: no node groups (vacuously compliant)
    prismaMock.nodeGroup.findMany.mockResolvedValue([]);
  });

  it("returns all nodes when no filters", async () => {
    const nodes = [makeNode({ id: "n1" }), makeNode({ id: "n2" })];
    prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);

    const result = await caller.list({ environmentId: "env-1" });

    expect(result).toHaveLength(2);
    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { environmentId: "env-1" },
      }),
    );
  });

  it("passes search filter to Prisma query", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([]);

    await caller.list({ environmentId: "env-1", search: "web" });

    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "web", mode: "insensitive" } },
            { host: { contains: "web", mode: "insensitive" } },
          ],
        }),
      }),
    );
  });

  it("passes status filter to Prisma query", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([]);

    await caller.list({ environmentId: "env-1", status: ["HEALTHY", "DEGRADED"] });

    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["HEALTHY", "DEGRADED"] },
        }),
      }),
    );
  });

  it("filters by labels post-query", async () => {
    const nodes = [
      makeNode({ id: "n1", labels: { env: "prod", region: "us-east" } }),
      makeNode({ id: "n2", labels: { env: "staging" } }),
      makeNode({ id: "n3", labels: { env: "prod", region: "eu-west" } }),
    ];
    prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);

    const result = await caller.list({
      environmentId: "env-1",
      labels: { env: "prod" },
    });

    expect(result).toHaveLength(2);
    expect(result.map((n: { id: string }) => n.id)).toEqual(["n1", "n3"]);
  });

  it("filters by multiple label key-value pairs (AND logic)", async () => {
    const nodes = [
      makeNode({ id: "n1", labels: { env: "prod", region: "us-east" } }),
      makeNode({ id: "n2", labels: { env: "prod", region: "eu-west" } }),
    ];
    prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);

    const result = await caller.list({
      environmentId: "env-1",
      labels: { env: "prod", region: "us-east" },
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("n1");
  });

  it("adds pushConnected to each result", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([makeNode({ id: "n1" })] as never);

    const result = await caller.list({ environmentId: "env-1" });

    expect(result[0]).toHaveProperty("pushConnected", false);
  });

  // ── label compliance ────────────────────────────────────────────────────

  it("returns labelCompliant=true when node has all required labels", async () => {
    const nodes = [makeNode({ id: "n1", labels: { region: "us-east", role: "worker" } })];
    prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);
    prismaMock.nodeGroup.findMany.mockResolvedValue([
      { requiredLabels: ["region", "role"] },
    ] as never);

    const result = await caller.list({ environmentId: "env-1" });

    expect(result[0]).toHaveProperty("labelCompliant", true);
  });

  it("returns labelCompliant=false when node is missing a required label", async () => {
    const nodes = [makeNode({ id: "n1", labels: { region: "us-east" } })];
    prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);
    prismaMock.nodeGroup.findMany.mockResolvedValue([
      { requiredLabels: ["region", "role"] },
    ] as never);

    const result = await caller.list({ environmentId: "env-1" });

    expect(result[0]).toHaveProperty("labelCompliant", false);
  });

  it("returns labelCompliant=true when no NodeGroups have required labels (vacuously compliant)", async () => {
    const nodes = [makeNode({ id: "n1", labels: {} })];
    prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);
    prismaMock.nodeGroup.findMany.mockResolvedValue([]);

    const result = await caller.list({ environmentId: "env-1" });

    expect(result[0]).toHaveProperty("labelCompliant", true);
  });
});
