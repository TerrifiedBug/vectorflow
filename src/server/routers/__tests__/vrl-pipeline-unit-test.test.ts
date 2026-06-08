import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import type { TransformEvalResult } from "@/server/services/transform-eval";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

// Passthrough the tenancy middleware so we exercise the handler's own
// org-scoping directly; the real withTeamAccess RBAC gate + cross-org boundary
// are covered by cross-org-access.test.ts. These handler tests pin the
// org-scoping that sits *underneath* that gate (every query filters
// organizationId) plus the per-component grouping/cap.
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

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) =>
      next({ ctx }),
    ),
}));

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

// evaluateVrl shells out to the `vector` binary; mock it so the runner is
// deterministic and we can assert the pass/fail decision in isolation.
vi.mock("@/server/services/transform-eval", () => ({
  evaluateVrl: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { vrlRouter } from "@/server/routers/vrl";
import { evaluateVrl } from "@/server/services/transform-eval";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(vrlRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
  organizationId: "org-1",
});

/** Build a full TransformEvalResult from just the surviving outputs (+ error). */
function evalResult(outputs: unknown[], error?: string): TransformEvalResult {
  return {
    outputs,
    inputCount: 1,
    outputCount: outputs.length,
    droppedCount: 1 - outputs.length,
    inputBytes: 10,
    outputBytes: outputs.length * 10,
    eventReductionPercent: 0,
    byteReductionPercent: 0,
    durationMs: 1,
    error,
  };
}

/** Identity transform: echo the single input event back as the output. */
function echoEval() {
  vi.mocked(evaluateVrl).mockImplementation(async (_source, events) =>
    evalResult([(events as unknown[])[0]]),
  );
}

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

describe("vrlRouter.runPipelineUnitTests", () => {
  it("returns empty results + zeroed summary when the pipeline has no saved tests", async () => {
    prismaMock.pipeline.findFirst.mockResolvedValue({
      nodes: [{ componentKey: "remap_1", config: { source: ".foo = 1" } }],
    } as never);
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([] as never);

    const res = await caller.runPipelineUnitTests({ pipelineId: "pipe-1" });

    expect(res).toEqual({ results: [], summary: { total: 0, passed: 0, failed: 0 } });
    expect(evaluateVrl).not.toHaveBeenCalled();
  });

  it("runs each component's tests against that component's current node source", async () => {
    prismaMock.pipeline.findFirst.mockResolvedValue({
      nodes: [
        { componentKey: "remap_1", config: { source: "SRC_ONE" } },
        { componentKey: "remap_2", config: { source: "SRC_TWO" } },
      ],
    } as never);
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([
      { id: "t1", name: "one", componentKey: "remap_1", input: { a: 1 }, expected: { a: 1 } },
      { id: "t2", name: "two", componentKey: "remap_2", input: { b: 2 }, expected: { b: 2 } },
    ] as never);
    echoEval();

    const res = await caller.runPipelineUnitTests({ pipelineId: "pipe-1" });

    // Each test ran against ITS component's persisted source, not a shared one.
    expect(evaluateVrl).toHaveBeenCalledWith("SRC_ONE", [{ a: 1 }], { orgId: "org-1" });
    expect(evaluateVrl).toHaveBeenCalledWith("SRC_TWO", [{ b: 2 }], { orgId: "org-1" });
    expect(res.results).toEqual([
      { id: "t1", name: "one", componentKey: "remap_1", passed: true, actual: { a: 1 }, expected: { a: 1 } },
      { id: "t2", name: "two", componentKey: "remap_2", passed: true, actual: { b: 2 }, expected: { b: 2 } },
    ]);
    expect(res.summary).toEqual({ total: 2, passed: 2, failed: 0 });
  });

  it("aggregates pass/fail across a component's tests into the summary", async () => {
    prismaMock.pipeline.findFirst.mockResolvedValue({
      nodes: [{ componentKey: "remap_1", config: { source: "SRC" } }],
    } as never);
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([
      { id: "t1", name: "pass", componentKey: "remap_1", input: { keep: true }, expected: { keep: true } },
      { id: "t2", name: "fail", componentKey: "remap_1", input: { keep: false }, expected: { keep: true } },
    ] as never);
    // Echo input->output: t1 matches `expected`, t2 does not.
    echoEval();

    const res = await caller.runPipelineUnitTests({ pipelineId: "pipe-1" });

    expect(res.summary).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(Object.fromEntries(res.results.map((r: { id: string; passed: boolean }) => [r.id, r.passed]))).toEqual({
      t1: true,
      t2: false,
    });
  });

  it("skips tests whose component has no current VRL source", async () => {
    prismaMock.pipeline.findFirst.mockResolvedValue({
      nodes: [
        { componentKey: "remap_1", config: { source: "SRC" } },
        // Source was cleared to whitespace — nothing meaningful to run against.
        { componentKey: "remap_blank", config: { source: "   " } },
      ],
    } as never);
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([
      { id: "t1", name: "live", componentKey: "remap_1", input: { a: 1 }, expected: { a: 1 } },
      { id: "t2", name: "blank", componentKey: "remap_blank", input: { a: 1 }, expected: { a: 1 } },
      // remap_gone has no node at all (component deleted after the test was saved).
      { id: "t3", name: "gone", componentKey: "remap_gone", input: { a: 1 }, expected: { a: 1 } },
    ] as never);
    echoEval();

    const res = await caller.runPipelineUnitTests({ pipelineId: "pipe-1" });

    expect(res.results.map((r: { id: string }) => r.id)).toEqual(["t1"]);
    expect(res.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(evaluateVrl).toHaveBeenCalledTimes(1);
    expect(evaluateVrl).toHaveBeenCalledWith("SRC", [{ a: 1 }], { orgId: "org-1" });
  });

  it("caps the number of tests run per component", async () => {
    prismaMock.pipeline.findFirst.mockResolvedValue({
      nodes: [{ componentKey: "remap_1", config: { source: "SRC" } }],
    } as never);
    const many = Array.from({ length: 55 }, (_, i) => ({
      id: `t${i}`,
      name: `t${i}`,
      componentKey: "remap_1",
      input: { i },
      expected: { i },
    }));
    prismaMock.vrlUnitTest.findMany.mockResolvedValue(many as never);
    echoEval();

    const res = await caller.runPipelineUnitTests({ pipelineId: "pipe-1" });

    expect(res.summary.total).toBe(50);
    expect(evaluateVrl).toHaveBeenCalledTimes(50);
  });

  it("org-scopes the pipeline and test lookups to the caller org", async () => {
    prismaMock.pipeline.findFirst.mockResolvedValue({ nodes: [] } as never);
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([] as never);

    await caller.runPipelineUnitTests({ pipelineId: "pipe-1" });

    expect(prismaMock.pipeline.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pipe-1", organizationId: "org-1" },
      }),
    );
    expect(prismaMock.vrlUnitTest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", pipelineId: "pipe-1" },
      }),
    );
  });

  it("throws NOT_FOUND when the pipeline is missing or owned by another org", async () => {
    prismaMock.pipeline.findFirst.mockResolvedValue(null as never);

    await expect(
      caller.runPipelineUnitTests({ pipelineId: "pipe-x" }),
    ).rejects.toThrow(/not found/i);
    expect(prismaMock.vrlUnitTest.findMany).not.toHaveBeenCalled();
  });
});
