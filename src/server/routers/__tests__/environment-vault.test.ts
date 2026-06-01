import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requirePlatformOperator: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/server/services/agent-token", () => ({
  generateEnrollmentToken: vi.fn(),
}));

vi.mock("@/server/services/crypto", () => ({
  encrypt: vi.fn((val: string) => `encrypted:${val}`),
  decrypt: vi.fn((val: string) => val.replace("encrypted:", "")),
}));

vi.mock("@/server/services/vault-client", () => ({
  testVaultConnection: vi.fn(),
  listVaultFields: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { environmentRouter } from "@/server/routers/environment";
import { listVaultFields, testVaultConnection } from "@/server/services/vault-client";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const vaultConnectionMock = vi.mocked(testVaultConnection);
const vaultFieldListMock = vi.mocked(listVaultFields);

const adminCaller = t.createCallerFactory(environmentRouter)({
  session: { user: { id: "user-1", email: "admin@test.com" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

function makeEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    id: "env-1",
    name: "Development",
    teamId: "team-1",
    isSystem: false,
    gitToken: null,
    enrollmentTokenHash: null,
    enrollmentTokenHint: null,
    gitWebhookSecret: null,
    gitOpsMode: "off",
    gitRepoUrl: null,
    gitBranch: null,
    gitProvider: null,
    requireDeployApproval: false,
    costPerGbCents: 0,
    costBudgetCents: null,
    secretBackend: "BUILTIN",
    secretBackendConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    nodes: [],
    _count: { nodes: 0, pipelines: 0 },
    team: { id: "team-1", name: "Test Team" },
    pipelines: [],
    ...overrides,
  };
}

describe("environment router Vault backend", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  it("redacts encrypted Vault credentials when reading an environment", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment({
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "approle",
        mountPath: "secret",
        role: "vectorflow-agent",
        roleId: "role-id",
        token: "encrypted:token",
        secretId: "encrypted:secret-id",
      },
    }) as never);

    const result = await adminCaller.get({ id: "env-1" });

    expect(result.secretBackendConfig).toEqual({
      address: "https://vault.example.com",
      authMethod: "approle",
      mountPath: "secret",
      role: "vectorflow-agent",
      roleId: "role-id",
      hasToken: true,
      hasSecretId: true,
    });
  });
  it("passes through Vault basePath when reading an environment", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment({
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        basePath: "vectorflow",
        token: "encrypted:token",
      },
    }) as never);

    const result = await adminCaller.get({ id: "env-1" });

    expect(result.secretBackendConfig).toEqual({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      basePath: "vectorflow",
      hasToken: true,
    });
  });

  it("redacts legacy Kubernetes JWT fields when reading an environment", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment({
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "kubernetes",
        mountPath: "secret",
        role: "vectorflow-agent",
        jwt: "plaintext-jwt",
        jwtPath: "/tmp/token",
      },
    }) as never);

    const result = await adminCaller.get({ id: "env-1" });

    expect(result.secretBackendConfig).toEqual({
      address: "https://vault.example.com",
      authMethod: "kubernetes",
      mountPath: "secret",
      role: "vectorflow-agent",
    });
  });

  it("encrypts Vault token and AppRole secret_id before storing", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
    prismaMock.environment.update.mockResolvedValue(makeEnvironment({ secretBackend: "VAULT" }) as never);

    await adminCaller.update({
      id: "env-1",
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "approle",
        mountPath: "secret",
        role: "vectorflow-agent",
        roleId: "role-id",
        secretId: "secret-id",

      },
    });

    const updateArg = prismaMock.environment.update.mock.calls[0]?.[0] as { data: { secretBackendConfig: Record<string, unknown> } };
    expect(updateArg.data.secretBackendConfig).toEqual(expect.objectContaining({
      secretId: "encrypted:secret-id",
      roleId: "role-id",
    }));
    expect(updateArg.data.secretBackendConfig).not.toHaveProperty("token");
  });
  it("stores Vault basePath alongside encrypted credentials", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
    prismaMock.environment.update.mockResolvedValue(makeEnvironment({ secretBackend: "VAULT" }) as never);

    await adminCaller.update({
      id: "env-1",
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "approle",
        mountPath: "secret",
        basePath: "vectorflow",
        roleId: "role-id",
        secretId: "secret-id",
      },
    });

    const updateArg = prismaMock.environment.update.mock.calls.at(-1)?.[0] as { data: { secretBackendConfig: Record<string, unknown> } };
    expect(updateArg.data.secretBackendConfig).toEqual(expect.objectContaining({
      basePath: "vectorflow",
      secretId: "encrypted:secret-id",
      roleId: "role-id",
    }));
  });

  it("stores AppRole config without requiring a Vault role name", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
    prismaMock.environment.update.mockResolvedValue(makeEnvironment({ secretBackend: "VAULT" }) as never);

    await adminCaller.update({
      id: "env-1",
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "approle",
        mountPath: "secret",
        roleId: "role-id",
        secretId: "secret-id",
      },
    });

    const approleUpdateArg = prismaMock.environment.update.mock.calls[0]?.[0] as { data: { secretBackendConfig: Record<string, unknown> } };
    expect(approleUpdateArg.data.secretBackendConfig).toEqual(expect.objectContaining({
      roleId: "role-id",
      secretId: "encrypted:secret-id",
    }));
    expect(approleUpdateArg.data.secretBackendConfig).not.toHaveProperty("role");
  });

  it("preserves stored Vault credentials when update leaves credential fields blank", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment({
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://old-vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        token: "encrypted:old-token",
      },
    }) as never);
    prismaMock.environment.update.mockResolvedValue(makeEnvironment({ secretBackend: "VAULT" }) as never);

    await adminCaller.update({
      id: "env-1",
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        token: "",
      },
    });

    expect(prismaMock.environment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        secretBackendConfig: expect.objectContaining({
          address: "https://vault.example.com",
          token: "encrypted:old-token",
        }),
      }),
    }));
  });

  it("rejects token auth without a new or stored token", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);

    await expect(adminCaller.update({
      id: "env-1",
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "token",
        mountPath: "secret",
      },
    })).rejects.toThrow("Vault token is required");
  });

  it("clears Vault config when switching back to the built-in backend", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment({
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        token: "encrypted:old-token",
      },
    }) as never);
    prismaMock.environment.update.mockResolvedValue(makeEnvironment({ secretBackend: "BUILTIN" }) as never);

    await adminCaller.update({ id: "env-1", secretBackend: "BUILTIN" });

    expect(prismaMock.environment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        secretBackend: "BUILTIN",
        secretBackendConfig: null,
      }),
    }));
  });

  it("rejects non-HTTPS Vault addresses", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);

    await expect(adminCaller.update({
      id: "env-1",
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "http://vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        token: "vault-token",
      },
    })).rejects.toThrow("Vault address must use HTTPS");
  });

  it("rejects dot segments in Vault mount paths", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);

    await expect(adminCaller.update({
      id: "env-1",
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "token",
        mountPath: "secret/../sys",
        token: "vault-token",
      },
    })).rejects.toThrow("Vault paths cannot contain . or .. segments");
  });
  it("rejects dot segments in Vault base paths", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);

    await expect(adminCaller.update({
      id: "env-1",
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        basePath: "../vectorflow",
        token: "vault-token",
      },
    })).rejects.toThrow("Vault paths cannot contain . or .. segments");
  });

  it("tests Vault connectivity with plaintext input credentials", async () => {
    vaultConnectionMock.mockResolvedValue({ success: true });

    const result = await adminCaller.testVaultConnection({
      environmentId: "env-1",
      config: {
        address: "https://vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        token: "plain-token",
      },
      testSecretPath: "healthcheck",
    });

    expect(result).toEqual({ success: true });
    expect(vaultConnectionMock).toHaveBeenCalledWith({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "plain-token",
    }, "healthcheck");
  });
  it("lists Vault fields for Vault-backed environments", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment({
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        basePath: "vectorflow",
        token: "encrypted:stored-token",
      },
    }) as never);
    vaultFieldListMock.mockResolvedValue(["GRAFANA_TOKEN", "OPENSEARCH_PROD"]);

    const result = await adminCaller.listVaultSecrets({ environmentId: "env-1" });

    expect(result).toEqual({
      backend: "VAULT",
      secrets: ["GRAFANA_TOKEN", "OPENSEARCH_PROD"],
    });
    expect(vaultFieldListMock).toHaveBeenCalledWith({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      basePath: "vectorflow",
      token: "stored-token",
    }, "vectorflow");
  });

  it("returns an empty list for built-in secret backends", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment({
      secretBackend: "BUILTIN",
      secretBackendConfig: null,
    }) as never);

    await expect(adminCaller.listVaultSecrets({ environmentId: "env-1" })).resolves.toEqual({
      backend: "BUILTIN",
      secrets: [],
    });
    expect(vaultFieldListMock).not.toHaveBeenCalled();
  });

  it("tests Vault connectivity with stored credentials when inputs are blank", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment({
      secretBackend: "VAULT",
      secretBackendConfig: {
        address: "https://old-vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        token: "encrypted:stored-token",
      },
    }) as never);
    vaultConnectionMock.mockResolvedValue({ success: true });

    const result = await adminCaller.testVaultConnection({
      environmentId: "env-1",
      config: {
        address: "https://vault.example.com",
        authMethod: "token",
        mountPath: "secret",
        token: "",
      },
    });

    expect(result).toEqual({ success: true });
    expect(vaultConnectionMock).toHaveBeenCalledWith({
      address: "https://vault.example.com",
      authMethod: "token",
      mountPath: "secret",
      token: "stored-token",
    }, undefined);
  });
});
