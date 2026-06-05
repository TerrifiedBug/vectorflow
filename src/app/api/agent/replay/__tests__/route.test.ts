import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { isLakeEnabledMock, nextReplayBatchMock } = vi.hoisted(() => ({
  isLakeEnabledMock: vi.fn<() => boolean>(() => true),
  nextReplayBatchMock: vi.fn(),
}));

vi.mock("@/server/services/agent-org-binding", () => ({
  resolveAgentOrg: vi
    .fn()
    .mockResolvedValue({ orgId: "org-1", orgSlug: "org-1", isLegacyToken: false }),
}));

vi.mock("@/server/services/agent-auth", () => ({
  authenticateAgentInOrg: vi.fn(() =>
    Promise.resolve({ nodeId: "node-1", environmentId: "env-1" }),
  ),
}));

vi.mock("@/app/api/_lib/ip-rate-limit", () => ({
  checkTokenRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

vi.mock("@/lib/logger", () => ({ errorLog: vi.fn(), warnLog: vi.fn() }));

vi.mock("@/server/services/lake/clickhouse", () => ({ isLakeEnabled: isLakeEnabledMock }));
vi.mock("@/server/services/lake/replay", () => ({ nextReplayBatch: nextReplayBatchMock }));

import { prisma } from "@/lib/prisma";
import { authenticateAgentInOrg } from "@/server/services/agent-auth";
import { POST } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeRequest(query = "?pipelineId=tgt"): Request {
  return new Request(`http://localhost/api/agent/replay${query}`, {
    method: "POST",
    headers: { authorization: "Bearer node-token" },
  });
}

function stampedEvent(message: string) {
  return {
    organizationId: "org-1",
    pipelineId: "src",
    eventType: "log",
    timestamp: "2026-06-01 00:00:00.000",
    message,
    raw: `{"m":"${message}"}`,
    replayJobId: "job-1",
    replayDedupeKey: "rpl_x",
  };
}

beforeEach(() => {
  mockReset(prismaMock);
  isLakeEnabledMock.mockReturnValue(true);
  nextReplayBatchMock.mockReset();
  vi.mocked(authenticateAgentInOrg).mockResolvedValue({ nodeId: "node-1", environmentId: "env-1" });
  // Pipeline belongs to the agent's environment by default.
  prismaMock.pipeline.findFirst.mockResolvedValue({ id: "tgt" } as never);
});

describe("POST /api/agent/replay", () => {
  it("returns 401 when the agent token is not authenticated", async () => {
    vi.mocked(authenticateAgentInOrg).mockResolvedValueOnce(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(nextReplayBatchMock).not.toHaveBeenCalled();
  });

  it("returns 204 and never queries when the lake is disabled", async () => {
    isLakeEnabledMock.mockReturnValue(false);
    const res = await POST(makeRequest());
    expect(res.status).toBe(204);
    expect(nextReplayBatchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when pipelineId is missing", async () => {
    const res = await POST(makeRequest(""));
    expect(res.status).toBe(400);
    expect(nextReplayBatchMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the pipeline is not in the agent's environment", async () => {
    prismaMock.pipeline.findFirst.mockResolvedValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(nextReplayBatchMock).not.toHaveBeenCalled();
  });

  it("scopes the next batch to the org + requested target pipeline", async () => {
    nextReplayBatchMock.mockResolvedValue(null);
    await POST(makeRequest("?pipelineId=tgt&batchSize=250"));
    expect(prismaMock.pipeline.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tgt", organizationId: "org-1", environmentId: "env-1" },
      }),
    );
    expect(nextReplayBatchMock).toHaveBeenCalledWith({
      orgId: "org-1",
      targetPipelineId: "tgt",
      batchSize: 250,
    });
  });

  it("returns 204 when there is no active job", async () => {
    nextReplayBatchMock.mockResolvedValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(204);
  });

  it("returns 200 NDJSON of dedupe-stamped events with job headers", async () => {
    nextReplayBatchMock.mockResolvedValue({
      jobId: "job-1",
      dedupeKey: "rpl_x",
      status: "RUNNING",
      replayedEvents: BigInt(2),
      totalEvents: BigInt(10),
      done: false,
      events: [stampedEvent("a"), stampedEvent("b")],
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(res.headers.get("X-VF-Replay-Job-Id")).toBe("job-1");
    expect(res.headers.get("X-VF-Replay-Status")).toBe("RUNNING");
    expect(res.headers.get("X-VF-Replay-Replayed")).toBe("2");
    expect(res.headers.get("X-VF-Replay-Total")).toBe("10");

    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0]).toMatchObject({ message: "a", replayDedupeKey: "rpl_x", replayJobId: "job-1" });
    expect(parsed[1]).toMatchObject({ message: "b", replayDedupeKey: "rpl_x" });
  });

  it("returns 204 with COMPLETED status header when the job drained this pull", async () => {
    nextReplayBatchMock.mockResolvedValue({
      jobId: "job-1",
      dedupeKey: "rpl_x",
      status: "COMPLETED",
      replayedEvents: BigInt(10),
      totalEvents: BigInt(10),
      done: true,
      events: [],
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(204);
    expect(res.headers.get("X-VF-Replay-Status")).toBe("COMPLETED");
    expect(res.headers.get("X-VF-Replay-Job-Id")).toBe("job-1");
  });
});
