import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { TRPCError } from "@trpc/server";

const { t, auditCalls } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  // A plain array (not a vi.fn) so `vi.clearAllMocks()` can't wipe the
  // composition calls that happen once at router module-load time.
  return { t: initTRPC.context().create(), auditCalls: [] as Array<[string, string]> };
});

// Passthrough the tenancy middleware so handler logic is exercised directly;
// cross-org gating is enforced by cross-org-access.test.ts walking the gate.
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

// Record the (action, entity) each procedure is audited with, then passthrough.
vi.mock("@/server/middleware/audit", () => ({
  withAudit: (action: string, entity: string) => {
    auditCalls.push([action, entity]);
    return t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) =>
      next({ ctx }),
    );
  },
}));

// lake-query (imported for its constants) pulls in prisma; keep it inert.
vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

// Mock the replay service so the router's input mapping, association checks and
// error translation are tested in isolation. ReplayError is a real class here
// so the router's `instanceof` translation fires.
vi.mock("@/server/services/lake/replay", () => {
  class ReplayError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
      this.name = "ReplayError";
    }
  }
  return {
    createReplayJob: vi.fn(),
    cancelReplayJob: vi.fn(),
    getReplayJob: vi.fn(),
    listReplayJobs: vi.fn(),
    ReplayError,
  };
});

// Mock the source-pipeline access gate; resolved by default in beforeEach.
vi.mock("@/server/authz", () => ({
  assertPipelineBatchAccess: vi.fn(),
}));

import { replayRouter } from "@/server/routers/replay";
import {
  createReplayJob,
  cancelReplayJob,
  getReplayJob,
  listReplayJobs,
  ReplayError,
} from "@/server/services/lake/replay";
import { assertPipelineBatchAccess } from "@/server/authz";

const createMock = vi.mocked(createReplayJob);
const cancelMock = vi.mocked(cancelReplayJob);
const getMock = vi.mocked(getReplayJob);
const listMock = vi.mocked(listReplayJobs);
const assertAccessMock = vi.mocked(assertPipelineBatchAccess);

const caller = t.createCallerFactory(replayRouter)({
  session: { user: { id: "user-1", email: "u@test.com", name: "U" } },
  userRole: "ADMIN",
  teamId: "team-1",
  organizationId: "org-1",
});

const FROM = new Date("2026-06-01T00:00:00.000Z");
const TO = new Date("2026-06-02T00:00:00.000Z");

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    organizationId: "org-1",
    sourcePipelineId: "src",
    targetPipelineId: "tgt",
    status: "PENDING",
    totalEvents: BigInt(5),
    replayedEvents: BigInt(0),
    dedupeKey: "rpl_x",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertAccessMock.mockResolvedValue({ teamId: "team-1", userRole: "ADMIN" } as never);
});

describe("replayRouter.create", () => {
  it("maps pipelineId→target and forwards org + user, returning the created job", async () => {
    createMock.mockResolvedValue(job() as never);

    const result = await caller.create({
      pipelineId: "tgt",
      sourcePipelineId: "src",
      fromTime: FROM,
      toTime: TO,
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        sourcePipelineId: "src",
        targetPipelineId: "tgt",
        fromTime: expect.any(Date),
        toTime: expect.any(Date),
        userId: "user-1",
      }),
    );
    expect(result).toMatchObject({ id: "job-1", status: "PENDING" });
  });

  it("denies create when the caller lacks source-pipeline team access", async () => {
    assertAccessMock.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: "not a member" }),
    );
    await expect(
      caller.create({ pipelineId: "tgt", sourcePipelineId: "src", fromTime: FROM, toTime: TO }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(assertAccessMock).toHaveBeenCalledWith(["src"], "user-1", "VIEWER", "org-1");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an inverted time range before calling the service", async () => {
    await expect(
      caller.create({ pipelineId: "tgt", sourcePipelineId: "src", fromTime: TO, toTime: FROM }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("translates LAKE_DISABLED → PRECONDITION_FAILED", async () => {
    createMock.mockRejectedValue(new ReplayError("off", "LAKE_DISABLED"));
    await expect(
      caller.create({ pipelineId: "tgt", sourcePipelineId: "src", fromTime: FROM, toTime: TO }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("translates SOURCE_NOT_FOUND → NOT_FOUND", async () => {
    createMock.mockRejectedValue(new ReplayError("missing", "SOURCE_NOT_FOUND"));
    await expect(
      caller.create({ pipelineId: "tgt", sourcePipelineId: "src", fromTime: FROM, toTime: TO }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("replayRouter.list", () => {
  it("lists replays for the pipeline, org-scoped", async () => {
    listMock.mockResolvedValue([job()] as never);
    const result = await caller.list({ pipelineId: "p1" });
    expect(listMock).toHaveBeenCalledWith({ orgId: "org-1", pipelineId: "p1" });
    expect(result).toHaveLength(1);
  });
});

describe("replayRouter.get", () => {
  it("returns the job when it references the supplied pipeline", async () => {
    getMock.mockResolvedValue(job({ targetPipelineId: "tgt" }) as never);
    const result = await caller.get({ pipelineId: "tgt", jobId: "job-1" });
    expect(getMock).toHaveBeenCalledWith({ orgId: "org-1", jobId: "job-1" });
    expect(result).toMatchObject({ id: "job-1" });
  });

  it("hides a job that does not reference the supplied pipeline (anti-spoof)", async () => {
    getMock.mockResolvedValue(job({ sourcePipelineId: "other", targetPipelineId: "other" }) as never);
    await expect(caller.get({ pipelineId: "tgt", jobId: "job-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns NOT_FOUND for an unknown job", async () => {
    getMock.mockResolvedValue(null);
    await expect(caller.get({ pipelineId: "tgt", jobId: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("replayRouter.cancel", () => {
  it("cancels a job that references the pipeline", async () => {
    getMock.mockResolvedValue(job({ targetPipelineId: "tgt" }) as never);
    cancelMock.mockResolvedValue(job({ status: "CANCELLED" }) as never);

    const result = await caller.cancel({ pipelineId: "tgt", jobId: "job-1" });

    expect(cancelMock).toHaveBeenCalledWith({ orgId: "org-1", jobId: "job-1" });
    expect(result).toMatchObject({ status: "CANCELLED" });
  });

  it("refuses to cancel a job that does not reference the pipeline", async () => {
    getMock.mockResolvedValue(job({ sourcePipelineId: "other", targetPipelineId: "other" }) as never);
    await expect(caller.cancel({ pipelineId: "tgt", jobId: "job-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("translates NOT_CANCELLABLE → CONFLICT", async () => {
    getMock.mockResolvedValue(job({ targetPipelineId: "tgt" }) as never);
    cancelMock.mockRejectedValue(new ReplayError("done", "NOT_CANCELLABLE"));
    await expect(caller.cancel({ pipelineId: "tgt", jobId: "job-1" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("replayRouter audit wiring", () => {
  it("audits create and cancel with the ReplayJob entity", () => {
    expect(auditCalls).toContainEqual(["replay.created", "ReplayJob"]);
    expect(auditCalls).toContainEqual(["replay.cancelled", "ReplayJob"]);
  });
});
