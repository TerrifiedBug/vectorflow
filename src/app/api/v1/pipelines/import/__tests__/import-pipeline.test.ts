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

vi.mock("@/lib/config-generator", () => ({
  importVectorConfig: vi.fn(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  encryptNodeConfig: vi.fn((_type: string, config: Record<string, unknown>) => config),
}));

vi.mock("../../../_lib/rate-limiter", () => ({
  rateLimiter: { check: vi.fn().mockReturnValue({ allowed: true, remaining: 99, retryAfter: 0 }) },
}));

import { prisma } from "@/lib/prisma";
import { authenticateApiKey, hasPermission } from "@/server/middleware/api-auth";
import { importVectorConfig } from "@/lib/config-generator";
import { POST } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const authMock = authenticateApiKey as ReturnType<typeof vi.fn>;
const permMock = hasPermission as ReturnType<typeof vi.fn>;
const importMock = importVectorConfig as ReturnType<typeof vi.fn>;

const CTX = {
  serviceAccountId: "sa-1",
  serviceAccountName: "ci-bot",
  environmentId: "env-1",
  permissions: ["pipelines.write"],
  rateLimit: null,
};

describe("POST /api/v1/pipelines/import", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("imports YAML and creates a pipeline with graph", async () => {
    importMock.mockReturnValue({
      nodes: [
        {
          id: "n1",
          type: "source",
          position: { x: 0, y: 0 },
          data: {
            componentKey: "vector.sources.file",
            componentDef: { type: "file", kind: "source" },
            config: { include: ["/var/log/**"] },
            disabled: false,
          },
        },
      ],
      edges: [],
      globalConfig: null,
    });

    const env = { teamId: "team-1" };
    prismaMock.environment.findUnique.mockResolvedValue(env as never);
    prismaMock.pipeline.findFirst.mockResolvedValue(null);

    const mockTx = {
      pipeline: {
        create: vi.fn().mockResolvedValue({ id: "pipe-1", name: "imported-pipe" }),
      },
      pipelineNode: {
        create: vi.fn().mockResolvedValue({ id: "n1" }),
      },
      pipelineEdge: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") return fn(mockTx);
    });

    const req = new NextRequest("http://localhost/api/v1/pipelines/import", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "imported-pipe",
        yaml: "sources:\n  file:\n    type: file\n    include:\n      - /var/log/**\n",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
  });

  it("returns 400 when yaml is missing", async () => {
    const req = new NextRequest("http://localhost/api/v1/pipelines/import", {
      method: "POST",
      headers: {
        authorization: "Bearer vf_test123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "test" }),
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });
});
