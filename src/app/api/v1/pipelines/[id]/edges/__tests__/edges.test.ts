import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/middleware/api-auth", () => ({
  authenticateApiKey: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock("@/server/services/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../../_lib/rate-limiter", () => ({
  rateLimiter: { check: vi.fn().mockReturnValue({ allowed: true, remaining: 99, retryAfter: 0 }) },
}));

import { prisma } from "@/lib/prisma";
import { authenticateApiKey, hasPermission } from "@/server/middleware/api-auth";
import { POST } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const authMock = authenticateApiKey as ReturnType<typeof vi.fn>;
const permMock = hasPermission as ReturnType<typeof vi.fn>;

const CTX = {
  serviceAccountId: "sa-1",
  serviceAccountName: "ci-bot",
  environmentId: "env-1",
  permissions: ["pipelines.write"],
  rateLimit: null,
};

describe("POST /api/v1/pipelines/{id}/edges", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("adds an edge between two nodes", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      environmentId: "env-1",
    } as never);
    prismaMock.pipelineNode.findFirst.mockResolvedValue({ id: "n1" } as never);
    prismaMock.pipelineEdge.create.mockResolvedValue({
      id: "edge-1",
      pipelineId: "pipe-1",
      sourceNodeId: "n1",
      targetNodeId: "n2",
      sourcePort: null,
    } as never);

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1/edges", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ sourceNodeId: "n1", targetNodeId: "n2" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pipe-1" }) });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.edge.sourceNodeId).toBe("n1");
  });

  it("returns 400 when sourceNodeId or targetNodeId is missing", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      environmentId: "env-1",
    } as never);

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1/edges", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ sourceNodeId: "n1" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pipe-1" }) });
    expect(res.status).toBe(400);
  });
});
