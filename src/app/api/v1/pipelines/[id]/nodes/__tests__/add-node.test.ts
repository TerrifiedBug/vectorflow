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

describe("POST /api/v1/pipelines/{id}/nodes", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("adds a node and returns 201", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      environmentId: "env-1",
    } as never);
    prismaMock.pipelineNode.create.mockResolvedValue({
      id: "node-1",
      pipelineId: "pipe-1",
      componentKey: "vector.sources.file",
      componentType: "file",
      kind: "SOURCE",
      config: { include: ["/var/log/**"] },
      positionX: 100,
      positionY: 200,
      disabled: false,
    } as never);

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1/nodes", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        componentKey: "vector.sources.file",
        componentType: "file",
        kind: "SOURCE",
        config: { include: ["/var/log/**"] },
        positionX: 100,
        positionY: 200,
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pipe-1" }) });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.node.componentKey).toBe("vector.sources.file");
  });
});
