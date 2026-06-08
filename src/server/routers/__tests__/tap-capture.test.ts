import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

// Passthrough the tenancy + audit middleware so we can exercise handler logic
// directly; cross-org gating is covered by cross-org-access.test.ts.
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

// evaluateVrl shells out to the `vector` binary; mock it so testTransform is
// deterministic and we can assert the stats mapping/reduction math.
vi.mock("@/server/services/transform-eval", () => ({
  evaluateVrl: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { tapCaptureRouter } from "@/server/routers/tap-capture";
import { evaluateVrl } from "@/server/services/transform-eval";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(tapCaptureRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
  organizationId: "org-1",
});

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
  // withOrgTx → basePrisma.$transaction(fn) after a set_config $executeRaw.
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  );
  prismaMock.$executeRaw.mockResolvedValue(1 as never);
});

describe("tapCaptureRouter.create", () => {
  it("persists supplied events with eventCount = events.length", async () => {
    const events = [{ a: 1 }, { a: 2 }, { a: 3 }];
    prismaMock.tapCapture.create.mockResolvedValue({
      id: "cap-1",
      name: "My capture",
      componentKey: "remap_1",
      eventCount: 3,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    } as never);

    const result = await caller.create({
      pipelineId: "pipe-1",
      name: "My capture",
      componentKey: "remap_1",
      events,
    });

    expect(result).toMatchObject({ id: "cap-1", eventCount: 3 });
    // Supplied events short-circuit the EventSample lookup.
    expect(prismaMock.eventSample.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.tapCapture.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          pipelineId: "pipe-1",
          name: "My capture",
          componentKey: "remap_1",
          eventCount: 3,
          createdById: "user-1",
        }),
      }),
    );
  });

  it("sources events from the most recent EventSample when events omitted", async () => {
    prismaMock.eventSample.findFirst.mockResolvedValue({
      events: [{ x: 1 }, { x: 2 }],
      schema: { x: "int" },
    } as never);
    prismaMock.tapCapture.create.mockResolvedValue({
      id: "cap-2",
      name: "From sample",
      componentKey: "filter_1",
      eventCount: 2,
      createdAt: new Date(),
    } as never);

    const result = await caller.create({
      pipelineId: "pipe-1",
      name: "From sample",
      componentKey: "filter_1",
    });

    expect(prismaMock.eventSample.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pipelineId: "pipe-1",
          componentKey: "filter_1",
          error: null,
        }),
        orderBy: { sampledAt: "desc" },
      }),
    );
    expect(prismaMock.tapCapture.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventCount: 2, schema: { x: "int" } }),
      }),
    );
    expect(result.eventCount).toBe(2);
  });

  it("throws NOT_FOUND when there is no EventSample to source from", async () => {
    prismaMock.eventSample.findFirst.mockResolvedValue(null);

    await expect(
      caller.create({ pipelineId: "pipe-1", name: "x", componentKey: "c" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prismaMock.tapCapture.create).not.toHaveBeenCalled();
  });

  it("rejects an explicitly empty capture", async () => {
    await expect(
      caller.create({ pipelineId: "pipe-1", name: "x", componentKey: "c", events: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prismaMock.eventSample.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.tapCapture.create).not.toHaveBeenCalled();
  });
});

describe("tapCaptureRouter.list", () => {
  it("returns capture summaries newest-first for the pipeline", async () => {
    const rows = [
      {
        id: "cap-1",
        name: "A",
        componentKey: "remap_1",
        eventCount: 5,
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    ];
    prismaMock.tapCapture.findMany.mockResolvedValue(rows as never);

    const result = await caller.list({ pipelineId: "pipe-1" });

    expect(result).toEqual(rows);
    expect(prismaMock.tapCapture.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pipelineId: "pipe-1" },
        orderBy: { createdAt: "desc" },
      }),
    );
  });
});

describe("tapCaptureRouter.get", () => {
  const base = {
    id: "cap-1",
    organizationId: "org-1",
    pipelineId: "pipe-1",
    name: "A",
    componentKey: "remap_1",
    eventCount: 1,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    events: [{ a: 1 }],
    schema: { a: "int" },
  };

  it("returns the capture (with events + schema) when pipeline + org match", async () => {
    prismaMock.tapCapture.findUnique.mockResolvedValue(base as never);

    const result = await caller.get({ pipelineId: "pipe-1", captureId: "cap-1" });

    expect(result.id).toBe("cap-1");
    expect(result.events).toEqual([{ a: 1 }]);
    expect(result.schema).toEqual({ a: "int" });
    // organizationId is never leaked in the response shape.
    expect(result).not.toHaveProperty("organizationId");
  });

  it("throws NOT_FOUND when the capture belongs to another org", async () => {
    prismaMock.tapCapture.findUnique.mockResolvedValue({
      ...base,
      organizationId: "org-2",
    } as never);

    await expect(
      caller.get({ pipelineId: "pipe-1", captureId: "cap-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when the capture belongs to a different pipeline", async () => {
    prismaMock.tapCapture.findUnique.mockResolvedValue({
      ...base,
      pipelineId: "pipe-other",
    } as never);

    await expect(
      caller.get({ pipelineId: "pipe-1", captureId: "cap-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tapCaptureRouter.delete", () => {
  it("deletes a capture scoped to pipeline + org and echoes the id for audit", async () => {
    prismaMock.tapCapture.deleteMany.mockResolvedValue({ count: 1 } as never);

    const result = await caller.delete({ pipelineId: "pipe-1", captureId: "cap-1" });

    expect(result).toEqual({ id: "cap-1", deleted: true });
    expect(prismaMock.tapCapture.deleteMany).toHaveBeenCalledWith({
      where: { id: "cap-1", pipelineId: "pipe-1", organizationId: "org-1" },
    });
  });

  it("throws NOT_FOUND when nothing matched the scoped delete", async () => {
    prismaMock.tapCapture.deleteMany.mockResolvedValue({ count: 0 } as never);

    await expect(
      caller.delete({ pipelineId: "pipe-1", captureId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tapCaptureRouter.testTransform", () => {
  const captureRow = {
    id: "cap-1",
    organizationId: "org-1",
    pipelineId: "pipe-1",
    name: "A",
    componentKey: "remap_1",
    eventCount: 3,
    createdAt: new Date(),
    events: [{ a: 1 }, { a: 2 }, { a: 3 }],
  };

  it("runs evaluateVrl against the capture events and returns the reduction stats", async () => {
    prismaMock.tapCapture.findUnique.mockResolvedValue(captureRow as never);
    vi.mocked(evaluateVrl).mockResolvedValue({
      outputs: [{ a: 1 }, { a: 2 }],
      inputCount: 3,
      outputCount: 2,
      droppedCount: 1,
      inputBytes: 30,
      outputBytes: 18,
      eventReductionPercent: 33.33,
      byteReductionPercent: 40,
      durationMs: 5,
    });

    const result = await caller.testTransform({
      pipelineId: "pipe-1",
      captureId: "cap-1",
      source: "del(.a)",
    });

    expect(evaluateVrl).toHaveBeenCalledWith("del(.a)", [{ a: 1 }, { a: 2 }, { a: 3 }], { orgId: "org-1" });
    expect(result.outputs).toHaveLength(2);
    expect(result.stats).toEqual({
      inputCount: 3,
      outputCount: 2,
      droppedCount: 1,
      eventReductionPercent: 33.33,
      byteReductionPercent: 40,
    });
    expect(result.error).toBeUndefined();
    // The raw byte counters + duration stay internal to the harness.
    expect(result.stats).not.toHaveProperty("inputBytes");
    expect(result.stats).not.toHaveProperty("durationMs");
  });

  it("propagates an evaluation error while still returning stats", async () => {
    prismaMock.tapCapture.findUnique.mockResolvedValue(captureRow as never);
    vi.mocked(evaluateVrl).mockResolvedValue({
      outputs: [],
      inputCount: 3,
      outputCount: 0,
      droppedCount: 3,
      inputBytes: 30,
      outputBytes: 0,
      eventReductionPercent: 100,
      byteReductionPercent: 100,
      durationMs: 2,
      error: "error[E103]: unhandled fallible assignment",
    });

    const result = await caller.testTransform({
      pipelineId: "pipe-1",
      captureId: "cap-1",
      source: "bogus",
    });

    expect(result.error).toBe("error[E103]: unhandled fallible assignment");
    expect(result.stats.droppedCount).toBe(3);
    expect(result.outputs).toEqual([]);
  });

  it("throws NOT_FOUND (and skips evaluateVrl) for a cross-org capture", async () => {
    prismaMock.tapCapture.findUnique.mockResolvedValue({
      ...captureRow,
      organizationId: "org-2",
    } as never);

    await expect(
      caller.testTransform({ pipelineId: "pipe-1", captureId: "cap-1", source: "." }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(evaluateVrl).not.toHaveBeenCalled();
  });
});
