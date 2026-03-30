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

vi.mock("@/server/services/fleet-data", () => ({
  getFleetOverview: vi.fn(),
  getVolumeTrend: vi.fn(),
  getNodeThroughput: vi.fn(),
  getNodeCapacity: vi.fn(),
  getDataLoss: vi.fn(),
  getMatrixThroughput: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { fleetRouter } from "@/server/routers/fleet";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(fleetRouter)({
  session: { user: { id: "user-1" } },
});

describe("fleet.matrixSummary", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns per-node aggregate summary", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValueOnce([
      {
        id: "node-1",
        name: "node-alpha",
        host: "10.0.0.1",
        apiPort: 8686,
        status: "HEALTHY",
        maintenanceMode: false,
        labels: {},
        pipelineStatuses: [
          {
            pipelineId: "pipe-1",
            status: "RUNNING",
            version: 2,
            pipeline: { id: "pipe-1", name: "logs", versions: [{ version: 2 }] },
          },
          {
            pipelineId: "pipe-2",
            status: "CRASHED",
            version: 1,
            pipeline: { id: "pipe-2", name: "metrics", versions: [{ version: 3 }] },
          },
        ],
      },
    ] as never);

    const result = await caller.matrixSummary({
      environmentId: "env-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].nodeId).toBe("node-1");
    expect(result[0].nodeName).toBe("node-alpha");
    expect(result[0].pipelineCount).toBe(2);
    expect(result[0].errorCount).toBe(1); // pipe-2 CRASHED
    expect(result[0].versionDriftCount).toBe(1); // pipe-2 deployed v1 but latest is v3
    expect(result[0].status).toBe("HEALTHY");
  });

  it("returns empty array when no nodes", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValueOnce([] as never);

    const result = await caller.matrixSummary({
      environmentId: "env-1",
    });

    expect(result).toEqual([]);
  });
});
