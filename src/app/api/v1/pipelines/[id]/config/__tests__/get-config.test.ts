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

vi.mock("@/lib/config-generator", () => ({
  generateVectorYaml: vi.fn(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn((_type: string, config: Record<string, unknown>) => config),
}));

vi.mock("../../../../_lib/rate-limiter", () => ({
  rateLimiter: { check: vi.fn().mockReturnValue({ allowed: true, remaining: 99, retryAfter: 0 }) },
}));

import { prisma } from "@/lib/prisma";
import { authenticateApiKey, hasPermission } from "@/server/middleware/api-auth";
import { generateVectorYaml } from "@/lib/config-generator";
import { GET } from "../route";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const authMock = authenticateApiKey as ReturnType<typeof vi.fn>;
const permMock = hasPermission as ReturnType<typeof vi.fn>;
const generateYamlMock = generateVectorYaml as ReturnType<typeof vi.fn>;

const CTX = {
  serviceAccountId: "sa-1",
  serviceAccountName: "ci-bot",
  environmentId: "env-1",
  permissions: ["pipelines.read"],
  rateLimit: null,
};

describe("GET /api/v1/pipelines/{id}/config", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    authMock.mockResolvedValue(CTX);
    permMock.mockReturnValue(true);
  });

  it("returns generated YAML config", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipe-1",
      environmentId: "env-1",
      globalConfig: null,
      enrichMetadata: false,
      environment: { name: "prod" },
      nodes: [
        {
          id: "n1",
          kind: "SOURCE",
          componentKey: "vector.sources.file",
          componentType: "file",
          config: {},
          positionX: 0,
          positionY: 0,
          disabled: false,
        },
      ],
      edges: [],
    } as never);

    generateYamlMock.mockReturnValue("sources:\n  file:\n    type: file\n");

    const req = new NextRequest("http://localhost/api/v1/pipelines/pipe-1/config", {
      method: "GET",
      headers: { authorization: "Bearer vf_test123" },
    });

    const res = await GET(req, { params: Promise.resolve({ id: "pipe-1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.config).toContain("sources:");
    expect(body.format).toBe("yaml");
  });

  it("returns 404 for non-existent pipeline", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/v1/pipelines/bad-id/config", {
      method: "GET",
      headers: { authorization: "Bearer vf_test123" },
    });

    const res = await GET(req, { params: Promise.resolve({ id: "bad-id" }) });
    expect(res.status).toBe(404);
  });
});
