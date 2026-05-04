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
  permissions: ["alerts.manage"],
  rateLimit: null,
};

describe("POST /api/v1/alerts/rules", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("returns 400 when ownerHint is not a string", async () => {
    const req = new NextRequest("http://localhost/api/v1/alerts/rules", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "CPU hot",
        metric: "cpu_usage",
        condition: "gt",
        threshold: 80,
        ownerHint: 123,
      }),
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "ownerHint must be a non-empty string",
    });
  });

  it("returns 400 when suggestedAction is null", async () => {
    const req = new NextRequest("http://localhost/api/v1/alerts/rules", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "CPU hot",
        metric: "cpu_usage",
        condition: "gt",
        threshold: 80,
        suggestedAction: null,
      }),
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "suggestedAction must be a non-empty string",
    });
  });
});
