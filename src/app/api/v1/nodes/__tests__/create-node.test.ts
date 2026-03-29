import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/server/middleware/api-auth", () => ({
  authenticateApiKey: vi.fn(),
  hasPermission: vi.fn(),
}));
vi.mock("@/server/services/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue({}) }));
vi.mock("../../../_lib/rate-limiter", () => ({
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
  permissions: ["nodes.manage"],
  rateLimit: null,
};

describe("POST /api/v1/nodes", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("registers a new node and returns 201", async () => {
    prismaMock.vectorNode.create.mockResolvedValue({
      id: "vn-1",
      name: "node-prod-01",
      host: "10.0.1.50",
      apiPort: 8686,
      environmentId: "env-1",
      status: "UNKNOWN",
      createdAt: new Date(),
    } as never);

    const req = new NextRequest("http://localhost/api/v1/nodes", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "node-prod-01", host: "10.0.1.50" }),
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.node.name).toBe("node-prod-01");
  });
});
