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
    requireSuperAdmin: passthrough,
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

vi.mock("@/server/services/pipeline-graph", () => ({
  saveGraphComponents: vi.fn(),
  discardPipelineChanges: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { pipelineGraphRouter } from "@/server/routers/pipeline-graph";
import { saveGraphComponents, discardPipelineChanges } from "@/server/services/pipeline-graph";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(pipelineGraphRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

describe("pipelineGraphRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ── saveGraph ─────────────────────────────────────────────────────────────

  describe("saveGraph", () => {
    it("saves graph components within a transaction", async () => {
      const savedResult = { pipelineId: "p-1", nodeCount: 2, edgeCount: 1 };
      vi.mocked(saveGraphComponents).mockResolvedValue(savedResult as never);
      prismaMock.$transaction.mockImplementation(async (fn) => {
        const fakeTx = {};
        return (fn as (tx: unknown) => unknown)(fakeTx);
      });

      const nodes = [
        {
          componentKey: "my_source",
          componentType: "stdin",
          kind: "SOURCE" as const,
          config: {},
          positionX: 100,
          positionY: 200,
        },
        {
          componentKey: "my_sink",
          componentType: "console",
          kind: "SINK" as const,
          config: {},
          positionX: 400,
          positionY: 200,
        },
      ];
      const edges = [{ sourceNodeId: "node-1", targetNodeId: "node-2" }];

      const result = await caller.saveGraph({
        pipelineId: "p-1",
        nodes,
        edges,
      });

      expect(result).toEqual(savedResult);
      expect(saveGraphComponents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          pipelineId: "p-1",
          nodes: expect.arrayContaining([
            expect.objectContaining({ componentKey: "my_source" }),
            expect.objectContaining({ componentKey: "my_sink" }),
          ]),
          edges: expect.arrayContaining([
            expect.objectContaining({ sourceNodeId: "node-1", targetNodeId: "node-2" }),
          ]),
          userId: "user-1",
        }),
      );
    });

    it("passes globalConfig to saveGraphComponents when provided", async () => {
      vi.mocked(saveGraphComponents).mockResolvedValue({} as never);
      prismaMock.$transaction.mockImplementation(async (fn) => (fn as (tx: unknown) => unknown)({}));

      await caller.saveGraph({
        pipelineId: "p-1",
        nodes: [
          {
            componentKey: "src_1",
            componentType: "stdin",
            kind: "SOURCE" as const,
            config: {},
            positionX: 0,
            positionY: 0,
          },
        ],
        edges: [],
        globalConfig: { log_level: "debug" },
      });

      expect(saveGraphComponents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          globalConfig: { log_level: "debug" },
        }),
      );
    });

    it("passes null globalConfig when explicitly set to null", async () => {
      vi.mocked(saveGraphComponents).mockResolvedValue({} as never);
      prismaMock.$transaction.mockImplementation(async (fn) => (fn as (tx: unknown) => unknown)({}));

      await caller.saveGraph({
        pipelineId: "p-1",
        nodes: [
          {
            componentKey: "src_1",
            componentType: "stdin",
            kind: "SOURCE" as const,
            config: {},
            positionX: 0,
            positionY: 0,
          },
        ],
        edges: [],
        globalConfig: null,
      });

      expect(saveGraphComponents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          globalConfig: null,
        }),
      );
    });
  });

  // ── discardChanges ────────────────────────────────────────────────────────

  describe("discardChanges", () => {
    it("delegates to discardPipelineChanges service", async () => {
      const discardResult = { success: true };
      vi.mocked(discardPipelineChanges).mockResolvedValue(discardResult as never);

      const result = await caller.discardChanges({ pipelineId: "p-1" });

      expect(result).toEqual(discardResult);
      expect(discardPipelineChanges).toHaveBeenCalledWith("p-1");
    });
  });
});
