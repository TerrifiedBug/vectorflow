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

vi.mock("@/server/services/config-crypto", () => ({
  encryptNodeConfig: vi.fn((_type: string, config: Record<string, unknown>) => config),
}));

vi.mock("../../../../../_lib/rate-limiter", () => ({
  rateLimiter: { check: vi.fn().mockReturnValue({ allowed: true, remaining: 99, retryAfter: 0 }) },
}));

import { prisma } from "@/lib/prisma";
import { authenticateApiKey, hasPermission } from "@/server/middleware/api-auth";
import { PUT, DELETE } from "../route";

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

describe("PUT /api/v1/pipelines/{id}/nodes/{nodeId}", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("updates node config and returns 200", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      environmentId: "env-1",
    } as never);
    prismaMock.pipelineNode.findFirst.mockResolvedValue({
      id: "node-1",
      pipelineId: "pipe-1",
      componentType: "file",
    } as never);
    prismaMock.pipelineNode.update.mockResolvedValue({
      id: "node-1",
      pipelineId: "pipe-1",
      componentKey: "vector.sources.file",
      componentType: "file",
      kind: "SOURCE",
      config: { include: ["/var/log/new/**"] },
      positionX: 100,
      positionY: 200,
      disabled: false,
    } as never);

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1/nodes/node-1", {
      method: "PUT",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ config: { include: ["/var/log/new/**"] } }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "pipe-1", nodeId: "node-1" }) });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/v1/pipelines/{id}/nodes/{nodeId}", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("removes node and connected edges", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      environmentId: "env-1",
    } as never);
    prismaMock.pipelineNode.findFirst.mockResolvedValue({
      id: "node-1",
      pipelineId: "pipe-1",
    } as never);
    prismaMock.pipelineEdge.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.pipelineNode.delete.mockResolvedValue({} as never);

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1/nodes/node-1", {
      method: "DELETE",
      headers: { authorization: "Bearer vf_test123" },
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: "pipe-1", nodeId: "node-1" }) });
    expect(res.status).toBe(200);
  });
});
