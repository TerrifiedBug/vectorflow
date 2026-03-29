import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/server/middleware/api-auth", () => ({
  authenticateApiKey: vi.fn(),
  hasPermission: vi.fn(),
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
  permissions: ["nodes.manage"],
  rateLimit: null,
};

describe("PUT /api/v1/nodes/{id}/labels", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("updates labels and returns updated node", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue({
      id: "vn-1",
      environmentId: "env-1",
    } as never);
    prismaMock.vectorNode.update.mockResolvedValue({
      id: "vn-1",
      name: "node-1",
      labels: { env: "production", region: "us-east" },
    } as never);

    const req = new NextRequest("http://localhost/api/v1/nodes/vn-1/labels", {
      method: "PUT",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ labels: { env: "production", region: "us-east" } }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "vn-1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.node.labels.env).toBe("production");
  });
});
