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

vi.mock("../../../_lib/rate-limiter", () => ({
  rateLimiter: { check: vi.fn().mockReturnValue({ allowed: true, remaining: 99, retryAfter: 0 }) },
}));

import { prisma } from "@/lib/prisma";
import { authenticateApiKey, hasPermission } from "@/server/middleware/api-auth";
import { POST } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const authMock = authenticateApiKey as ReturnType<typeof vi.fn>;
const permMock = hasPermission as ReturnType<typeof vi.fn>;

const SERVICE_ACCOUNT_CTX = {
  serviceAccountId: "sa-1",
  serviceAccountName: "ci-bot",
  environmentId: "env-1",
  permissions: ["pipelines.write"],
  rateLimit: null,
};

describe("POST /api/v1/pipelines", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(SERVICE_ACCOUNT_CTX);
    permMock.mockReturnValue(true);
  });

  it("creates a pipeline and returns 201", async () => {
    const created = {
      id: "pipe-1",
      name: "nginx-logs",
      description: "Collects nginx logs",
      isDraft: true,
      deployedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prismaMock.pipeline.create.mockResolvedValue(created as never);

    const req = new NextRequest("http://localhost/api/v1/pipelines", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "nginx-logs", description: "Collects nginx logs" }),
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.pipeline.id).toBe("pipe-1");
    expect(body.pipeline.name).toBe("nginx-logs");
  });

  it("returns 400 when name is missing", async () => {
    const req = new NextRequest("http://localhost/api/v1/pipelines", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ description: "no name" }),
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });

  it("returns 403 when lacking pipelines.write permission", async () => {
    permMock.mockReturnValue(false);

    const req = new NextRequest("http://localhost/api/v1/pipelines", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "test" }),
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
  });
});
