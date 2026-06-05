import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── vi.hoisted so `t` + the capture buffers are available in vi.mock factories ─
//
// `gateRoles` records the role each `withTeamAccess(role)` gate guards, keyed by
// the middleware instance the factory returns (tRPC stores that exact instance
// in `procedure._def.middlewares`). `auditCalls` records every
// `withAudit(action, entity)` wiring. Both are populated at router-construction
// (import) time and are plain structures, so `vi.clearAllMocks()` never wipes
// them — the gating/audit assertions read these import-time captures.

const { t, prismaHolder, auditCalls } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  return {
    t: initTRPC.context().create(),
    prismaHolder: {} as { mock?: DeepMockProxy<PrismaClient> },
    auditCalls: [] as Array<{ action: string; entity: string }>,
  };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (o: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: (role: string) => {
      const fn = ({ next, ctx }: { next: (o: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx });
      (fn as unknown as { _vfGateRole?: string })._vfGateRole = role;
      return t.middleware(fn);
    },
    requirePlatformOperator: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: (action: string, entity: string) => {
    auditCalls.push({ action, entity });
    return t.middleware(({ next, ctx }: { next: (o: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  },
}));

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  prismaHolder.mock = __pm;
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

// Run the tenant transaction body directly against the prisma mock (tx === mock).
vi.mock("@/lib/with-org-tx", () => ({
  withOrgTx: (_orgId: string, fn: (tx: unknown) => unknown) => fn(prismaHolder.mock),
}));

vi.mock("@/server/services/agent-token", () => ({
  generateEnrollmentToken: vi.fn(),
}));

// Mirror the shared crypto mock: v2 ciphertext is `encrypted:<plaintext>`, so a
// stored value that equals the plaintext would mean encryption never ran.
vi.mock("@/server/services/crypto", () => ({
  ENCRYPTION_DOMAINS: { GENERIC: "generic" } as const,
  encrypt: vi.fn((val: string) => `encrypted:${val}`),
  decrypt: vi.fn((val: string) => val.replace("encrypted:", "")),
  encryptForOrg: vi.fn(async (val: string) => `v3:${val}`),
  decryptForOrg: vi.fn(async (val: string) => val.replace(/^v3:/, "")),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { environmentRouter } from "@/server/routers/environment";
import * as crypto from "@/server/services/crypto";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const caller = t.createCallerFactory(environmentRouter)({
  session: { user: { id: "user-1", email: "admin@test.com" } },
  userRole: "ADMIN",
  teamId: "team-1",
  organizationId: "default",
});

// Mirror the cross-org-access walker's access pattern: a wrapping router exposes
// every procedure under its dotted path in `_def.procedures`, retaining the same
// middleware instances we tagged in `gateRoles`.
const appRouter = t.router({ environment: environmentRouter });

/** Resolve the role guarding a procedure via its captured `withTeamAccess` gate. */
function gateRoleFor(path: string): string | undefined {
  const procs = (
    appRouter as unknown as {
      _def: { procedures: Record<string, { _def?: { middlewares?: unknown[] } }> };
    }
  )._def.procedures;
  for (const mw of procs[path]?._def?.middlewares ?? []) {
    const role = (mw as { _vfGateRole?: string })._vfGateRole;
    if (role) return role;
  }
  return undefined;
}

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
  // OSS / self-hosted org: no DEK → crypto-v3 callsite falls back to v2 `encrypt`.
  prismaMock.organization.findUnique.mockResolvedValue({ dataKeyCiphertext: null } as never);
});

describe("environment.setLakeBucket", () => {
  it("encrypts the access key id and secret access key before persisting", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default", isSystem: false } as never);
    prismaMock.environmentLakeBucket.upsert.mockResolvedValue({} as never);
    prismaMock.environmentLakeBucket.findUnique.mockResolvedValue({ provider: "s3" } as never);
    prismaMock.lakeDataset.updateMany.mockResolvedValue({ count: 0 } as never);

    await caller.setLakeBucket({
      environmentId: "env-1",
      provider: "s3",
      bucket: "my-bucket",
      accessKeyId: "AKIA-PLAINTEXT",
      secretAccessKey: "SECRET-PLAINTEXT",
    });

    expect(crypto.encrypt).toHaveBeenCalledWith("AKIA-PLAINTEXT", "generic");
    expect(crypto.encrypt).toHaveBeenCalledWith("SECRET-PLAINTEXT", "generic");

    const upsertArg = prismaMock.environmentLakeBucket.upsert.mock.calls[0]![0] as {
      create: { encryptedAccessKeyId: string; encryptedSecretAccessKey: string };
    };
    // Persisted at rest as ciphertext — never the plaintext credential.
    expect(upsertArg.create.encryptedAccessKeyId).toBe("encrypted:AKIA-PLAINTEXT");
    expect(upsertArg.create.encryptedSecretAccessKey).toBe("encrypted:SECRET-PLAINTEXT");
    expect(upsertArg.create.encryptedAccessKeyId).not.toBe("AKIA-PLAINTEXT");
    expect(upsertArg.create.encryptedSecretAccessKey).not.toBe("SECRET-PLAINTEXT");
  });

  it("marks the environment's datasets external for a non-searchable (gcs) bucket", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default", isSystem: false } as never);
    prismaMock.environmentLakeBucket.upsert.mockResolvedValue({} as never);
    prismaMock.environmentLakeBucket.findUnique.mockResolvedValue({ provider: "gcs" } as never);
    prismaMock.lakeDataset.updateMany.mockResolvedValue({ count: 3 } as never);

    const result = await caller.setLakeBucket({
      environmentId: "env-1",
      provider: "gcs",
      bucket: "gcs-bucket",
    });

    expect(result.searchable).toBe(false);
    // Every searchable dataset is demoted to external (degraded search).
    expect(prismaMock.lakeDataset.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "default", environmentId: "env-1", tiering: { not: "external" } },
      data: { tiering: "external" },
    });
  });

  it("keeps datasets searchable (reverts external→cold) for an s3 bucket", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default", isSystem: false } as never);
    prismaMock.environmentLakeBucket.upsert.mockResolvedValue({} as never);
    prismaMock.environmentLakeBucket.findUnique.mockResolvedValue({ provider: "s3" } as never);
    prismaMock.lakeDataset.updateMany.mockResolvedValue({ count: 0 } as never);

    const result = await caller.setLakeBucket({
      environmentId: "env-1",
      provider: "s3",
      bucket: "my-bucket",
    });

    expect(result.searchable).toBe(true);
    expect(prismaMock.lakeDataset.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "default", environmentId: "env-1", tiering: "external" },
      data: { tiering: "cold" },
    });
  });

  it("rejects the system environment", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default", isSystem: true } as never);

    await expect(
      caller.setLakeBucket({ environmentId: "sys", provider: "s3", bucket: "b" }),
    ).rejects.toThrow();
    expect(prismaMock.environmentLakeBucket.upsert).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for a missing environment", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(null);

    await expect(
      caller.setLakeBucket({ environmentId: "ghost", provider: "s3", bucket: "b" }),
    ).rejects.toThrow("Environment not found");
  });
});

describe("environment.getLakeBucket", () => {
  it("returns only presence flags, never the stored credentials", async () => {
    prismaMock.environmentLakeBucket.findUnique.mockResolvedValue({
      provider: "s3",
      bucket: "my-bucket",
      region: "us-east-1",
      endpoint: null,
      prefix: null,
      encryptedAccessKeyId: "encrypted:AKIA-PLAINTEXT",
      encryptedSecretAccessKey: "encrypted:SECRET-PLAINTEXT",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const result = await caller.getLakeBucket({ environmentId: "env-1" });

    expect(result).not.toBeNull();
    expect(result!.hasAccessKeyId).toBe(true);
    expect(result!.hasSecretAccessKey).toBe(true);
    expect(result!.searchable).toBe(true);
    // No credential material leaks — neither the ciphertext columns nor plaintext.
    expect(result).not.toHaveProperty("encryptedAccessKeyId");
    expect(result).not.toHaveProperty("encryptedSecretAccessKey");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("AKIA-PLAINTEXT");
    expect(serialized).not.toContain("SECRET-PLAINTEXT");
    expect(serialized).not.toContain("encrypted:");
    // Read path must never decrypt.
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it("reports searchable=false for an external-only (azure) bucket", async () => {
    prismaMock.environmentLakeBucket.findUnique.mockResolvedValue({
      provider: "azure",
      bucket: "blob",
      region: null,
      endpoint: null,
      prefix: null,
      encryptedAccessKeyId: null,
      encryptedSecretAccessKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const result = await caller.getLakeBucket({ environmentId: "env-1" });

    expect(result!.searchable).toBe(false);
    expect(result!.hasAccessKeyId).toBe(false);
    expect(result!.hasSecretAccessKey).toBe(false);
  });

  it("returns null when no bucket is configured", async () => {
    prismaMock.environmentLakeBucket.findUnique.mockResolvedValue(null);

    const result = await caller.getLakeBucket({ environmentId: "env-1" });

    expect(result).toBeNull();
  });
});

describe("environment.clearLakeBucket", () => {
  it("deletes the bucket row and reverts tiering to cold", async () => {
    prismaMock.environment.findUnique.mockResolvedValue({ organizationId: "default" } as never);
    prismaMock.environmentLakeBucket.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.environmentLakeBucket.findUnique.mockResolvedValue(null);
    prismaMock.lakeDataset.updateMany.mockResolvedValue({ count: 2 } as never);

    const result = await caller.clearLakeBucket({ environmentId: "env-1" });

    expect(prismaMock.environmentLakeBucket.deleteMany).toHaveBeenCalledWith({
      where: { environmentId: "env-1" },
    });
    // Reverted to VF-managed (searchable) → demoted datasets recover to cold.
    expect(result.searchable).toBe(true);
    expect(prismaMock.lakeDataset.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "default", environmentId: "env-1", tiering: "external" },
      data: { tiering: "cold" },
    });
  });
});

describe("tenancy + audit wiring", () => {
  it("gates getLakeBucket on VIEWER and set/clear on ADMIN", () => {
    expect(gateRoleFor("environment.getLakeBucket")).toBe("VIEWER");
    expect(gateRoleFor("environment.setLakeBucket")).toBe("ADMIN");
    expect(gateRoleFor("environment.clearLakeBucket")).toBe("ADMIN");
  });

  it("audits the set and clear mutations against the Environment entity", () => {
    expect(auditCalls).toContainEqual({ action: "environment.lake_bucket_set", entity: "Environment" });
    expect(auditCalls).toContainEqual({ action: "environment.lake_bucket_cleared", entity: "Environment" });
  });
});
