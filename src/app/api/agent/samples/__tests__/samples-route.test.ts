import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/agent-auth", () => ({
  authenticateAgent: vi.fn(() =>
    Promise.resolve({ nodeId: "node-1", environmentId: "env-1" }),
  ),
}));

vi.mock("@/lib/logger", () => ({
  errorLog: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { POST } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/agent/samples", {
    method: "POST",
    headers: {
      authorization: "Bearer test-node-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function setupPendingRequest(overrides: Record<string, unknown> = {}) {
  prismaMock.eventSampleRequest.findUnique.mockResolvedValue({
    id: "req-1",
    pipelineId: "pipe-1",
    componentKeys: ["src-1"],
    status: "PENDING",
    nodeId: "node-1",
    pipeline: { environmentId: "env-1" },
    ...overrides,
  } as never);
  prismaMock.eventSample.create.mockResolvedValue({ id: "sample-1" } as never);
  prismaMock.eventSample.findMany.mockResolvedValue([
    { componentKey: "src-1", error: null },
  ] as never);
  prismaMock.eventSampleRequest.updateMany.mockResolvedValue({ count: 1 } as never);
}

describe("POST /api/agent/samples", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
    setupPendingRequest();
  });

  it("stores sample results for the node assigned to the request", async () => {
    const response = await POST(
      makeRequest({
        results: [{ requestId: "req-1", componentKey: "src-1", events: [{ ok: true }] }],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(prismaMock.eventSample.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: "req-1",
          pipelineId: "pipe-1",
          componentKey: "src-1",
        }),
      }),
    );
  });

  it("does not store sample results from a node that was not assigned the request", async () => {
    setupPendingRequest({ nodeId: "node-2" });
    // Atomic claim fails — request is bound to node-2, this agent is node-1.
    prismaMock.eventSampleRequest.updateMany.mockResolvedValueOnce({ count: 0 } as never);

    const response = await POST(
      makeRequest({
        results: [{ requestId: "req-1", componentKey: "src-1", events: [{ secret: true }] }],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(prismaMock.eventSample.create).not.toHaveBeenCalled();
  });

  it("atomically claims an unassigned request (fan-out path) and stores the sample", async () => {
    setupPendingRequest({ nodeId: null });
    prismaMock.eventSampleRequest.updateMany.mockResolvedValueOnce({ count: 1 } as never);

    const response = await POST(
      makeRequest({
        results: [{ requestId: "req-1", componentKey: "src-1", events: [{ ok: true }] }],
      }),
    );

    expect(response.status).toBe(200);
    expect(prismaMock.eventSampleRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "req-1",
          status: "PENDING",
          OR: [{ nodeId: null }, { nodeId: "node-1" }],
        }),
        data: { nodeId: "node-1" },
      }),
    );
    expect(prismaMock.eventSample.create).toHaveBeenCalled();
  });

  it("does not store sample results for a component outside the request context", async () => {
    const response = await POST(
      makeRequest({
        results: [{ requestId: "req-1", componentKey: "other-component", events: [{ secret: true }] }],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(prismaMock.eventSample.create).not.toHaveBeenCalled();
    // Component check runs before the atomic claim so we don't bind the
    // request to this agent just to drop the sample.
    expect(prismaMock.eventSampleRequest.updateMany).not.toHaveBeenCalled();
  });
});
