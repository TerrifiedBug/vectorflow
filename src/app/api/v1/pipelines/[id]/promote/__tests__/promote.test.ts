import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
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
import { POST } from "../route";

const authMock = authenticateApiKey as ReturnType<typeof vi.fn>;
const permMock = hasPermission as ReturnType<typeof vi.fn>;
const promoteMock = promotePipeline as ReturnType<typeof vi.fn>;

const CTX = {
  serviceAccountId: "sa-1",
  serviceAccountName: "ci-bot",
  environmentId: "env-1",
  permissions: ["pipelines.promote"],
  rateLimit: null,
};

describe("POST /api/v1/pipelines/{id}/promote", () => {
  beforeEach(() => {
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
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
