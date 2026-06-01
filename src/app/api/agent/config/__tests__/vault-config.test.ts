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
        secretBackend: "VAULT",
        secretBackendConfig: {
          address: "https://vault.example.com",
          authMethod: "token",
          mountPath: "secret",
          basePath: "vectorflow",
          token: "encrypted:vault-token",
        },
      }),
    ),
  },
  pipeline: {
    findMany: vi.fn(() => Promise.resolve([
      {
        id: "pipe-1",
        name: "Vault Pipeline",
        nodeSelector: {},
        versions: [
          {
            version: 7,
            configYaml: "sources:\n  in:\n    type: demo_logs\nsinks:\n  out:\n    type: console\n    auth:\n      password: SECRET[db-password]\n",
            logLevel: "info",
          },
        ],
      },
      {
        id: "pipe-2",
        name: "Second Vault Pipeline",
        nodeSelector: {},
        versions: [
          {
            version: 8,
            configYaml: "sinks:\n  out:\n    type: console\n    auth:\n      token: SECRET[api-token]\n",
            logLevel: "debug",
          },
        ],
      },
    ])),
  },
  eventSampleRequest: { findMany: vi.fn(() => Promise.resolve([])) },
   systemSettings: {
     findUnique: vi.fn(() => Promise.resolve({ fleetPollIntervalMs: 15000 })),
   },
   organizationSettings: {
     findUnique: vi.fn(),
     create: vi.fn(),
   },
}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/crypto", () => ({
  decrypt: vi.fn((value: string) => value.replace("encrypted:", "")),
}));

vi.mock("@/server/services/vault-client", () => ({
  fetchVaultSecrets: vi.fn(),
  readVaultSecretObject: vi.fn(() => Promise.resolve({
    "db-password": "from-vault",
    "api-token": "from-vault-api",
  })),
}));

vi.mock("@/server/services/drift-metrics", () => ({
  setExpectedChecksum: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/server/services/crypto";
 import { mockOrgSettings } from "@/__tests__/helpers/mock-org-settings";
import { fetchVaultSecrets, readVaultSecretObject } from "@/server/services/vault-client";

const prismaMock = prisma as unknown as {
  pipeline: { findMany: ReturnType<typeof vi.fn> };
  secret?: { findMany: ReturnType<typeof vi.fn> };
  organizationSettings: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};
const readVaultSecretObjectMock = vi.mocked(readVaultSecretObject);

 describe("GET /api/agent/config — Vault backend", () => {
 beforeEach(() => {
   vi.clearAllMocks();
   prismaMock.organizationSettings.findUnique.mockResolvedValue(mockOrgSettings());
   prismaMock.organizationSettings.create.mockResolvedValue(mockOrgSettings());
   });

  it("resolves Vault secrets into agent env vars without sending Vault config", async () => {
    const { GET } = await import("@/app/api/agent/config/route");

    const request = new Request("http://localhost/api/agent/config", {
      method: "GET",
      headers: { authorization: "Bearer test-node-token" },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(readVaultSecretObject).toHaveBeenCalledWith({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      basePath: "vectorflow",
      token: "vault-token",
    }, "vectorflow");
    expect(readVaultSecretObject).toHaveBeenCalledTimes(1);
    expect(fetchVaultSecrets).not.toHaveBeenCalled();
    expect(decrypt).toHaveBeenCalledWith("encrypted:vault-token");
    expect(body.secretBackend).toBe("VAULT");
    expect(body.secretBackendConfig).toBeUndefined();
    expect(body.pipelines[0].secrets).toEqual({ VF_SECRET_DB_PASSWORD: "from-vault" });
    expect(body.pipelines[0].configYaml).toContain('password: "${VF_SECRET_DB_PASSWORD}"');
    expect(body.pipelines[1].secrets).toEqual({ VF_SECRET_API_TOKEN: "from-vault-api" });
    expect(body.pipelines[1].configYaml).toContain('token: "${VF_SECRET_API_TOKEN}"');
    expect(prismaMock.secret?.findMany).toBeUndefined();
  });

  it("skips only the pipeline whose Vault secret cannot be read", async () => {
    prismaMock.pipeline.findMany.mockResolvedValueOnce([
      {
        id: "pipe-good",
        name: "Good Vault Pipeline",
        nodeSelector: {},
        versions: [
          {
            version: 1,
            configYaml: "sinks:\n  out:\n    type: console\n    auth:\n      password: SECRET[good-secret]\n",
            logLevel: null,
          },
        ],
      },
      {
        id: "pipe-bad",
        name: "Bad Vault Pipeline",
        nodeSelector: {},
        versions: [
          {
            version: 1,
            configYaml: "sinks:\n  out:\n    type: console\n    auth:\n      password: SECRET[missing-secret]\n",
            logLevel: null,
          },
        ],
      },
    ]);
    readVaultSecretObjectMock.mockResolvedValueOnce({
      "good-secret": "good-value",
    });

    const { GET } = await import("@/app/api/agent/config/route");
    const response = await GET(new Request("http://localhost/api/agent/config"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pipelines).toHaveLength(1);
    expect(body.pipelines[0].pipelineId).toBe("pipe-good");
    expect(body.pipelines[0].secrets).toEqual({ VF_SECRET_GOOD_SECRET: "good-value" });
    expect(readVaultSecretObject).toHaveBeenCalledWith(expect.objectContaining({
      basePath: "vectorflow",
    }), "vectorflow");
    expect(fetchVaultSecrets).not.toHaveBeenCalled();
  });
});
