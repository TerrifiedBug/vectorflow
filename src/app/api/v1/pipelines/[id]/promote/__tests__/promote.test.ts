import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });
vi.mock("@/server/middleware/api-auth", () => ({
  authenticateApiKey: vi.fn(),
  hasPermission: vi.fn(),
}));
vi.mock("@/server/services/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue({}) }));
vi.mock("@/server/services/pipeline-graph", () => ({
  promotePipeline: vi.fn(),
}));
vi.mock("../../../../_lib/rate-limiter", () => ({
  rateLimiter: { check: vi.fn().mockReturnValue({ allowed: true, remaining: 99, retryAfter: 0 }) },
}));

import { authenticateApiKey, hasPermission } from "@/server/middleware/api-auth";
import { promotePipeline } from "@/server/services/pipeline-graph";
import { prisma } from "@/lib/prisma";
import type { DeepMockProxy } from "vitest-mock-extended";
import { POST } from "../route";

const authMock = authenticateApiKey as ReturnType<typeof vi.fn>;
const permMock = hasPermission as ReturnType<typeof vi.fn>;
const promoteMock = promotePipeline as ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const CTX = {
  serviceAccountId: "sa-1",
  serviceAccountName: "ci-bot",
  environmentId: "env-1",
  organizationId: "org-1",
  permissions: ["pipelines.promote"],
  rateLimit: null,
};

describe("POST /api/v1/pipelines/{id}/promote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
    // By default the source pipeline belongs to the caller's environment.
    prismaMock.pipeline.findUnique.mockResolvedValue({ id: "pipe-1" } as never);
  });

  it("promotes a pipeline to target environment", async () => {
    promoteMock.mockResolvedValue({
      id: "pipe-new",
      name: "promoted-pipe",
      targetEnvironmentName: "staging",
      strippedSecrets: [],
      strippedCertificates: [],
    });

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1/promote", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ targetEnvironmentId: "env-2" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pipe-1" }) });
    expect(res.status).toBe(201);
    // The source pipeline lookup is scoped to the caller's environment.
    expect(prismaMock.pipeline.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pipe-1", environmentId: "env-1" },
      }),
    );
  });

  it("returns 404 when the source pipeline is not in the caller's environment (VF-09 IDOR)", async () => {
    // VF-09: the promote route previously passed the raw path param straight to
    // promotePipeline without scoping it to ctx.environmentId, allowing a
    // service account to promote pipelines belonging to other teams.
    prismaMock.pipeline.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/v1/pipelines/foreign-pipe/promote", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ targetEnvironmentId: "env-2" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "foreign-pipe" }) });
    expect(res.status).toBe(404);
    // The promotion service must never run for an unauthorized source.
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it("returns 400 when targetEnvironmentId is missing", async () => {
    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1/promote", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pipe-1" }) });
    expect(res.status).toBe(400);
  });
});
