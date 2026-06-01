import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/_lib/ip-rate-limit", () => ({
  checkTokenRateLimit: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/server/services/agent-org-binding", () => ({
  resolveAgentOrg: vi.fn().mockResolvedValue({ orgId: "default", orgSlug: "default", isLegacyToken: false }),
}));

vi.mock("@/server/services/agent-auth", () => ({
  authenticateAgentInOrg: vi.fn(() =>
    Promise.resolve({ nodeId: "node-1", environmentId: "env-1" }),
  ),
}));

vi.mock("@/lib/prisma", () => { const __pm = {
  vectorNode: {
    findUnique: vi.fn(() =>
      Promise.resolve({ pendingAction: null, maintenanceMode: false, labels: {} }),
    ),
  },
  environment: {
    findUnique: vi.fn(() =>
      Promise.resolve({
        id: "env-1",
        organizationId: "org-1",
        secretBackend: "BUILTIN",
        secretBackendConfig: null,
      }),
    ),
  },
  secret: { findMany: vi.fn() },
  variable: { findMany: vi.fn(() => Promise.resolve([])) },
  pipeline: { findMany: vi.fn() },
  eventSampleRequest: { findMany: vi.fn(() => Promise.resolve([])) },
  organizationSettings: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

// Real secret-resolver / variable-resolver logic is exercised; only the
// underlying decryption + DEK lookup is stubbed.
vi.mock("@/server/services/crypto-v3-callsite", () => ({
  decryptForOrgOrFallback: vi.fn((value: string) =>
    Promise.resolve(value.replace("encrypted:", "")),
  ),
  loadOrgDataKeyCiphertext: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/server/services/crypto", () => ({
  decrypt: vi.fn((value: string) => value.replace("encrypted:", "")),
  ENCRYPTION_DOMAINS: { GENERIC: "generic" },
}));

vi.mock("@/server/services/drift-metrics", () => ({
  setExpectedChecksum: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { mockOrgSettings } from "@/__tests__/helpers/mock-org-settings";

const prismaMock = prisma as unknown as {
  secret: { findMany: ReturnType<typeof vi.fn> };
  variable: { findMany: ReturnType<typeof vi.fn> };
  pipeline: { findMany: ReturnType<typeof vi.fn> };
  organizationSettings: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

describe("GET /api/agent/config — BUILTIN backend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.organizationSettings.findUnique.mockResolvedValue(mockOrgSettings());
    prismaMock.organizationSettings.create.mockResolvedValue(mockOrgSettings());
    prismaMock.variable.findMany.mockResolvedValue([]);
  });

  it("scopes BUILTIN secrets to each pipeline's own references", async () => {
    // pipe-a references only secret-a; pipe-b references only secret-b. Each
    // pipeline must receive ONLY its own secret, never the other's.
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      {
        id: "pipe-a",
        name: "Pipeline A",
        nodeSelector: {},
        versions: [
          {
            version: 1,
            configYaml:
              "sinks:\n  out:\n    type: console\n    auth:\n      password: SECRET[secret-a]\n",
            logLevel: null,
            variablesSnapshot: null,
          },
        ],
      },
      {
        id: "pipe-b",
        name: "Pipeline B",
        nodeSelector: {},
        versions: [
          {
            version: 1,
            configYaml:
              "sinks:\n  out:\n    type: console\n    auth:\n      token: SECRET[secret-b]\n",
            logLevel: null,
            variablesSnapshot: null,
          },
        ],
      },
    ]);
    prismaMock.secret.findMany.mockResolvedValueOnce([
      { id: "s-a", name: "secret-a", encryptedValue: "encrypted:value-a" },
      { id: "s-b", name: "secret-b", encryptedValue: "encrypted:value-b" },
    ]);

    const { GET } = await import("@/app/api/agent/config/route");
    const response = await GET(new Request("http://localhost/api/agent/config"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pipelines).toHaveLength(2);

    const pipeA = body.pipelines.find((p: { pipelineId: string }) => p.pipelineId === "pipe-a");
    const pipeB = body.pipelines.find((p: { pipelineId: string }) => p.pipelineId === "pipe-b");

    // Per-pipeline scoping: A gets only secret-a, B gets only secret-b.
    expect(pipeA.secrets).toEqual({ VF_SECRET_SECRET_A: "value-a" });
    expect(pipeB.secrets).toEqual({ VF_SECRET_SECRET_B: "value-b" });
    expect(pipeA.secrets).not.toHaveProperty("VF_SECRET_SECRET_B");
    expect(pipeB.secrets).not.toHaveProperty("VF_SECRET_SECRET_A");
  });

  it("skips a pipeline whose VAR reference cannot be resolved", async () => {
    // pipe-good resolves its variable; pipe-bad references an unknown variable
    // and must be dropped rather than shipped with a literal VAR[...] value.
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      {
        id: "pipe-good",
        name: "Good Pipeline",
        nodeSelector: {},
        versions: [
          {
            version: 1,
            configYaml: "sinks:\n  out:\n    type: console\n    target: VAR[known]\n",
            logLevel: null,
            variablesSnapshot: { known: "resolved-value" },
          },
        ],
      },
      {
        id: "pipe-bad",
        name: "Bad Pipeline",
        nodeSelector: {},
        versions: [
          {
            version: 1,
            configYaml: "sinks:\n  out:\n    type: console\n    target: VAR[missing]\n",
            logLevel: null,
            variablesSnapshot: null,
          },
        ],
      },
    ]);
    prismaMock.secret.findMany.mockResolvedValueOnce([]);

    const { GET } = await import("@/app/api/agent/config/route");
    const response = await GET(new Request("http://localhost/api/agent/config"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pipelines).toHaveLength(1);
    expect(body.pipelines[0].pipelineId).toBe("pipe-good");
    expect(body.pipelines[0].configYaml).toContain("resolved-value");
    // The broken pipeline must never appear, and no literal VAR[...] is shipped.
    expect(body.pipelines[0].configYaml).not.toContain("VAR[");
    expect(
      body.pipelines.some((p: { pipelineId: string }) => p.pipelineId === "pipe-bad"),
    ).toBe(false);
  });
});
