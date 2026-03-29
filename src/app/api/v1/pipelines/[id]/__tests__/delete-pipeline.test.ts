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
import { DELETE } from "../route";

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

describe("DELETE /api/v1/pipelines/{id}", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("deletes a pipeline and returns 200", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      name: "test-pipe",
      environmentId: "env-1",
      isDraft: true,
    } as never);
    prismaMock.pipeline.delete.mockResolvedValue({} as never);

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1", {
      method: "DELETE",
      headers: { authorization: "Bearer vf_test123" },
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: "pipe-1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deleted).toBe(true);
  });

  it("returns 409 if pipeline is deployed", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      name: "test-pipe",
      environmentId: "env-1",
      isDraft: false,
      deployedAt: new Date(),
    } as never);

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1", {
      method: "DELETE",
      headers: { authorization: "Bearer vf_test123" },
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: "pipe-1" }) });
    expect(res.status).toBe(409);
  });

  it("returns 404 for non-existent pipeline", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/v1/pipelines/bad-id", {
      method: "DELETE",
      headers: { authorization: "Bearer vf_test123" },
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: "bad-id" }) });
    expect(res.status).toBe(404);
  });
});
