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

// Passthrough the tenancy + audit middleware so we can exercise handler logic
// directly; the real withTeamAccess RBAC gate + cross-org boundary are covered
// by cross-org-access.test.ts. These handler tests pin the org-scoping that
// sits *underneath* that gate (every query filters organizationId).
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
import { vrlRouter, deepEqualUnordered } from "@/server/routers/vrl";
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

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

describe("deepEqualUnordered", () => {
  it("treats objects with reordered keys as equal", () => {
    expect(deepEqualUnordered({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("recurses through nested objects regardless of key order", () => {
    expect(
      deepEqualUnordered(
        { outer: { x: 1, y: 2 }, z: 3 },
        { z: 3, outer: { y: 2, x: 1 } },
      ),
    ).toBe(true);
  });

  it("keeps array element order significant", () => {
    expect(deepEqualUnordered([1, 2], [2, 1])).toBe(false);
    expect(deepEqualUnordered([1, 2], [1, 2])).toBe(true);
  });

  it("returns false on differing values, missing keys, or type mismatch", () => {
    expect(deepEqualUnordered({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqualUnordered({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(deepEqualUnordered({ a: 1 }, [1])).toBe(false);
    expect(deepEqualUnordered({ a: 1 }, null)).toBe(false);
    expect(deepEqualUnordered(1, "1")).toBe(false);
  });
});

describe("vrlRouter.createUnitTest", () => {
  it("persists the test stamped with the caller's organizationId", async () => {
    prismaMock.vrlUnitTest.count.mockResolvedValue(0 as never);
    prismaMock.vrlUnitTest.create.mockResolvedValue({
      id: "ut-1",
      name: "drops debug",
      componentKey: "remap_1",
      input: { level: "debug" },
      expected: { level: "info" },
      createdAt: new Date(),
    } as never);

    const result = await caller.createUnitTest({
      pipelineId: "pipe-1",
      componentKey: "remap_1",
      name: "drops debug",
      input: { level: "debug" },
      expected: { level: "info" },
    });

    expect(result.id).toBe("ut-1");
    const callArg = prismaMock.vrlUnitTest.create.mock.calls[0][0];
    expect(callArg.data).toMatchObject({
      organizationId: "org-1",
      pipelineId: "pipe-1",
      componentKey: "remap_1",
      name: "drops debug",
      input: { level: "debug" },
      expected: { level: "info" },
    });
  });

  it("rejects creating beyond the per-component cap", async () => {
    prismaMock.vrlUnitTest.count.mockResolvedValue(50 as never);
    await expect(
      caller.createUnitTest({
        pipelineId: "pipe-1",
        componentKey: "remap_1",
        name: "one too many",
        input: { level: "debug" },
        expected: { level: "info" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prismaMock.vrlUnitTest.create).not.toHaveBeenCalled();
  });
});

describe("vrlRouter.listUnitTests", () => {
  it("scopes the query to the caller org + pipeline", async () => {
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([] as never);

    await caller.listUnitTests({ pipelineId: "pipe-1" });

    expect(prismaMock.vrlUnitTest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", pipelineId: "pipe-1" },
      }),
    );
  });

  it("narrows to a single component when componentKey is supplied", async () => {
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([] as never);

    await caller.listUnitTests({ pipelineId: "pipe-1", componentKey: "remap_1" });

    expect(prismaMock.vrlUnitTest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", pipelineId: "pipe-1", componentKey: "remap_1" },
      }),
    );
  });
});

describe("vrlRouter.deleteUnitTest", () => {
  it("deletes scoped to id + org and echoes the id for audit", async () => {
    prismaMock.vrlUnitTest.deleteMany.mockResolvedValue({ count: 1 } as never);

    const result = await caller.deleteUnitTest({ id: "ut-1" });

    expect(result).toEqual({ id: "ut-1", deleted: true });
    expect(prismaMock.vrlUnitTest.deleteMany).toHaveBeenCalledWith({
      where: { id: "ut-1", organizationId: "org-1" },
    });
  });

  it("throws NOT_FOUND when nothing matched the org-scoped delete", async () => {
    prismaMock.vrlUnitTest.deleteMany.mockResolvedValue({ count: 0 } as never);

    await expect(caller.deleteUnitTest({ id: "other-org" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("vrlRouter.runUnitTests", () => {
  it("loads tests scoped to the caller org + pipeline + component", async () => {
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([] as never);

    await caller.runUnitTests({ pipelineId: "pipe-1", componentKey: "remap_1", source: "." });

    expect(prismaMock.vrlUnitTest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", pipelineId: "pipe-1", componentKey: "remap_1" },
      }),
    );
  });

  it("reports passed when the single output deep-equals expected (key order ignored)", async () => {
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([
      { id: "ut-1", name: "set level", input: { level: "debug" }, expected: { level: "info", host: "h" } },
    ] as never);
    // vector emits keys in a different order than `expected` — still a pass.
    vi.mocked(evaluateVrl).mockResolvedValue(evalResult([{ host: "h", level: "info" }]));

    const results = await caller.runUnitTests({
      pipelineId: "pipe-1",
      componentKey: "remap_1",
      source: '.level = "info"',
    });

    expect(evaluateVrl).toHaveBeenCalledWith('.level = "info"', [{ level: "debug" }], { orgId: "org-1" });
    expect(results).toEqual([
      { id: "ut-1", name: "set level", passed: true, actual: { host: "h", level: "info" }, expected: { level: "info", host: "h" } },
    ]);
  });

  it("reports failed when the output differs from expected", async () => {
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([
      { id: "ut-1", name: "set level", input: { level: "debug" }, expected: { level: "info" } },
    ] as never);
    vi.mocked(evaluateVrl).mockResolvedValue(evalResult([{ level: "warn" }]));

    const [result] = await caller.runUnitTests({
      pipelineId: "pipe-1",
      componentKey: "remap_1",
      source: ".",
    });

    expect(result.passed).toBe(false);
    expect(result.actual).toEqual({ level: "warn" });
  });

  it("reports failed when evaluation errors (compile error)", async () => {
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([
      { id: "ut-1", name: "t", input: { a: 1 }, expected: { a: 1 } },
    ] as never);
    vi.mocked(evaluateVrl).mockResolvedValue(evalResult([], "error[E103]: unhandled fallible assignment"));

    const [result] = await caller.runUnitTests({
      pipelineId: "pipe-1",
      componentKey: "remap_1",
      source: "bogus",
    });

    expect(result.passed).toBe(false);
    expect(result.actual).toBeNull();
  });

  it("reports failed when the event was dropped (no output)", async () => {
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([
      { id: "ut-1", name: "t", input: { a: 1 }, expected: { a: 1 } },
    ] as never);
    vi.mocked(evaluateVrl).mockResolvedValue(evalResult([]));

    const [result] = await caller.runUnitTests({
      pipelineId: "pipe-1",
      componentKey: "remap_1",
      source: "abort",
    });

    expect(result.passed).toBe(false);
    expect(result.actual).toBeNull();
  });

  it("runs every saved test and preserves order in the report", async () => {
    prismaMock.vrlUnitTest.findMany.mockResolvedValue([
      { id: "ut-1", name: "pass", input: { keep: true }, expected: { keep: true } },
      { id: "ut-2", name: "fail", input: { keep: false }, expected: { keep: true } },
    ] as never);
    // Keyed on the input event so order/identity is unambiguous under Promise.all.
    vi.mocked(evaluateVrl).mockImplementation(async (_source, events) => {
      const event = (events as Array<{ keep: boolean }>)[0];
      return evalResult([{ keep: event.keep }]);
    });

    const results = await caller.runUnitTests({
      pipelineId: "pipe-1",
      componentKey: "remap_1",
      source: ".",
    });

    expect(results.map((r: { id: string; passed: boolean }) => [r.id, r.passed])).toEqual([
      ["ut-1", true],
      ["ut-2", false],
    ]);
    expect(evaluateVrl).toHaveBeenCalledTimes(2);
  });
});
