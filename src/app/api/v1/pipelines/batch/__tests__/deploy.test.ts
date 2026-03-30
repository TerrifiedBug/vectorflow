import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
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
  writeAuditLog: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/server/services/deploy-agent", () => ({
  deployBatch: vi.fn(),
}));

vi.mock("../../_lib/rate-limiter", () => ({
  rateLimiter: {
    check: vi.fn().mockReturnValue({
      allowed: true,
      remaining: 99,
      retryAfter: 0,
    }),
  },
}));

import {
  authenticateApiKey,
  hasPermission,
} from "@/server/middleware/api-auth";
import { deployBatch } from "@/server/services/deploy-agent";
import { POST } from "../deploy/route";

const authMock = authenticateApiKey as ReturnType<typeof vi.fn>;
const permMock = hasPermission as ReturnType<typeof vi.fn>;
const deployBatchMock = deployBatch as ReturnType<typeof vi.fn>;

const SERVICE_ACCOUNT_CTX = {
  serviceAccountId: "sa-1",
  serviceAccountName: "ci-bot",
  environmentId: "env-1",
  permissions: ["pipelines.deploy"],
  rateLimit: null,
};

describe("POST /api/v1/pipelines/batch/deploy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue(SERVICE_ACCOUNT_CTX);
    permMock.mockReturnValue(true);
  });

  it("deploys multiple pipelines and returns results", async () => {
    deployBatchMock.mockResolvedValue({
      total: 2,
      completed: 2,
      failed: 0,
      results: [
        {
          pipelineId: "pipe-1",
          success: true,
          versionId: "v1",
          versionNumber: 1,
        },
        {
          pipelineId: "pipe-2",
          success: true,
          versionId: "v2",
          versionNumber: 1,
        },
      ],
    });

    const req = new NextRequest(
      "http://localhost/api/v1/pipelines/batch/deploy",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer vf_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pipelineIds: ["pipe-1", "pipe-2"],
          changelog: "Batch deploy via CI",
        }),
      },
    );

    const res = await POST(req, { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.completed).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.results).toHaveLength(2);
  });

  it("returns 400 if pipelineIds is missing or empty", async () => {
    const req = new NextRequest(
      "http://localhost/api/v1/pipelines/batch/deploy",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer vf_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ changelog: "test" }),
      },
    );

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });

  it("returns 400 if pipelineIds exceeds 200", async () => {
    const req = new NextRequest(
      "http://localhost/api/v1/pipelines/batch/deploy",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer vf_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pipelineIds: Array(201).fill("id"),
          changelog: "test",
        }),
      },
    );

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });

  it("returns 401 if not authenticated", async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest(
      "http://localhost/api/v1/pipelines/batch/deploy",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer vf_invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pipelineIds: ["pipe-1"],
          changelog: "test",
        }),
      },
    );

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });
});
