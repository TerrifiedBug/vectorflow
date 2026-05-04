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
import { PUT } from "../route";

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

describe("PUT /api/v1/pipelines/{id}", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("updates pipeline name and description", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      environmentId: "env-1",
    } as never);
    prismaMock.pipeline.update.mockResolvedValue({
      id: "pipe-1",
      name: "updated-name",
      description: "new desc",
      isDraft: true,
      deployedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1", {
      method: "PUT",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "updated-name", description: "new desc" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "pipe-1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pipeline.name).toBe("updated-name");
  });

  it("returns 404 for non-existent pipeline", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/v1/pipelines/bad-id", {
      method: "PUT",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "test" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "bad-id" }) });
    expect(res.status).toBe(404);
  });

  it("rejects groupId from a different environment", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      environmentId: "env-1",
    } as never);
    prismaMock.pipelineGroup.findUnique.mockResolvedValue({
      environmentId: "env-2",
    } as never);

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1", {
      method: "PUT",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ groupId: "group-2" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "pipe-1" }) });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe("Pipeline group not found in this environment");
    expect(prismaMock.pipeline.update).not.toHaveBeenCalled();
  });
});
