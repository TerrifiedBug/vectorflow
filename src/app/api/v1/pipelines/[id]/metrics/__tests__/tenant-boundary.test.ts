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

vi.mock("../../../../_lib/rate-limiter", () => ({
  rateLimiter: { check: vi.fn().mockReturnValue({ allowed: true, remaining: 99, retryAfter: 0 }) },
}));

import { prisma } from "@/lib/prisma";
import { authenticateApiKey, hasPermission } from "@/server/middleware/api-auth";
import { GET } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const authMock = authenticateApiKey as ReturnType<typeof vi.fn>;
const permMock = hasPermission as ReturnType<typeof vi.fn>;

const CTX = {
  serviceAccountId: "sa-1",
  serviceAccountName: "ci-bot",
  environmentId: "env-1",
  permissions: ["metrics.read"],
  rateLimit: null,
};

describe("GET /api/v1/pipelines/{id}/metrics tenant boundary", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("does not read metrics for a pipeline outside the service account environment", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-team-2/metrics", {
      method: "GET",
      headers: { authorization: "Bearer vf_test123" },
    });

    const res = await GET(req, { params: Promise.resolve({ id: "pipe-team-2" }) });

    expect(res.status).toBe(404);
    expect(prismaMock.pipeline.findUnique).toHaveBeenCalledWith({
      where: { id: "pipe-team-2", environmentId: "env-1" },
      select: { id: true },
    });
    expect(prismaMock.pipelineMetric.findMany).not.toHaveBeenCalled();
  });
});
