/**
 * `requirePlatformOperator(role)` middleware.
 *
 * Migration to this middleware is complete: every router callsite has been flipped
 * from the legacy `requireSuperAdmin` to this gate, and the legacy
 * middleware (along with the `User.isSuperAdmin` column) was removed in
 * slice 7c.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { TRPCError, initTRPC } from "@trpc/server";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { prisma } from "@/lib/prisma";
import { requirePlatformOperator } from "@/trpc/init";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

interface MockCtx {
  session?: {
    user: { id: string; email: string; name?: string };
  } | null;
  organizationId?: string;
  ipAddress?: string | null;
  orgMemberRole?: unknown;
}

// Spin up a tiny tRPC instance whose context shape matches the real one,
// then mount a procedure that uses `requirePlatformOperator`. Calling
// the procedure exercises the middleware end-to-end.
function mountProcedure(minRole?: Parameters<typeof requirePlatformOperator>[0]) {
  const t = initTRPC.context<MockCtx>().create();
  const proc = t.procedure
    .use(requirePlatformOperator(minRole) as never)
    .query(() => "ok");
  const router = t.router({ probe: proc });
  return t.createCallerFactory(router);
}

const ADMIN_SESSION: MockCtx = {
  session: { user: { id: "u-1", email: "alice@vectorflow.ops", name: "Alice" } },
};

beforeEach(() => {
  mockReset(prismaMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requirePlatformOperator", () => {
  it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    const caller = mountProcedure()({ session: null });
    await expect(caller.probe()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects callers whose session has no email", async () => {
    const caller = mountProcedure()({
      session: {
        user: { id: "u-1", email: "" },
      },
    });
    await expect(caller.probe()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects callers whose email is NOT a PlatformOperator (FORBIDDEN)", async () => {
    prismaMock.platformOperator.findUnique.mockResolvedValue(null);
    const caller = mountProcedure()(ADMIN_SESSION);
    await expect(caller.probe()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/platform operator session/i),
    });
  });

  it("accepts a SUPPORT operator at the SUPPORT gate (default)", async () => {
    prismaMock.platformOperator.findUnique.mockResolvedValue({
      id: "op-1",
      email: "alice@vectorflow.ops",
      name: "Alice",
      role: "SUPPORT",
    } as never);

    const caller = mountProcedure()(ADMIN_SESSION);
    await expect(caller.probe()).resolves.toBe("ok");
  });

  it("accepts a higher-rank operator at a lower gate (INCIDENT can do SUPPORT work)", async () => {
    prismaMock.platformOperator.findUnique.mockResolvedValue({
      id: "op-1",
      email: "alice@vectorflow.ops",
      name: "Alice",
      role: "INCIDENT",
    } as never);

    const caller = mountProcedure("SUPPORT")(ADMIN_SESSION);
    await expect(caller.probe()).resolves.toBe("ok");
  });

  it("rejects a lower-rank operator at a higher gate (SUPPORT cannot do INFRA work)", async () => {
    prismaMock.platformOperator.findUnique.mockResolvedValue({
      id: "op-1",
      email: "alice@vectorflow.ops",
      name: "Alice",
      role: "SUPPORT",
    } as never);

    const caller = mountProcedure("INFRA")(ADMIN_SESSION);
    await expect(caller.probe()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/role INFRA or higher/),
    });
  });

  it("looks up operator by email (not user id) so the same email across orgs maps to one operator", async () => {
    prismaMock.platformOperator.findUnique.mockResolvedValue({
      id: "op-1",
      email: "alice@vectorflow.ops",
      name: "Alice",
      role: "SUPPORT",
    } as never);

    const caller = mountProcedure()(ADMIN_SESSION);
    await caller.probe();

    expect(prismaMock.platformOperator.findUnique).toHaveBeenCalledWith({
      where: { email: "alice@vectorflow.ops" },
      select: { id: true, email: true, name: true, role: true, deletedAt: true },
    });
  });

  it("rejects a soft-deleted (deletedAt != null) operator with FORBIDDEN", async () => {
    prismaMock.platformOperator.findUnique.mockResolvedValue({
      id: "op_decommissioned",
      email: "ex-alice@vectorflow.ops",
      name: "Ex-Alice",
      role: "SUPPORT",
      deletedAt: new Date("2026-05-17T00:00:00.000Z"),
    } as never);

    const caller = mountProcedure()(ADMIN_SESSION);
    await expect(caller.probe()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/decommissioned/i),
    });
  });

  it("propagates database failures as the original error (does NOT fail open)", async () => {
    prismaMock.platformOperator.findUnique.mockRejectedValue(
      new Error("connection lost"),
    );

    const caller = mountProcedure()(ADMIN_SESSION);
    // Fail-closed: a DB error MUST surface as a thrown error (eventually
    // mapped to 500 by tRPC), not silently grant access.
    await expect(caller.probe()).rejects.toThrow("connection lost");
  });

  it("each role rank assertion: BILLING > SUPPORT, INFRA > BILLING, INCIDENT > INFRA", async () => {
    // The rank ordering is part of the public contract. Pin it.
    const cases: Array<{
      operatorRole: "SUPPORT" | "BILLING" | "INFRA" | "INCIDENT";
      gate: "SUPPORT" | "BILLING" | "INFRA" | "INCIDENT";
      shouldPass: boolean;
    }> = [
      { operatorRole: "SUPPORT", gate: "SUPPORT", shouldPass: true },
      { operatorRole: "SUPPORT", gate: "BILLING", shouldPass: false },
      { operatorRole: "BILLING", gate: "SUPPORT", shouldPass: true },
      { operatorRole: "BILLING", gate: "INFRA", shouldPass: false },
      { operatorRole: "INFRA", gate: "BILLING", shouldPass: true },
      { operatorRole: "INFRA", gate: "INCIDENT", shouldPass: false },
      { operatorRole: "INCIDENT", gate: "INFRA", shouldPass: true },
      { operatorRole: "INCIDENT", gate: "INCIDENT", shouldPass: true },
    ];

    for (const c of cases) {
      mockReset(prismaMock);
      prismaMock.platformOperator.findUnique.mockResolvedValue({
        id: "op-1",
        email: "alice@vectorflow.ops",
        name: "Alice",
        role: c.operatorRole,
      } as never);
      const caller = mountProcedure(c.gate)(ADMIN_SESSION);
      if (c.shouldPass) {
        await expect(caller.probe()).resolves.toBe("ok");
      } else {
        await expect(caller.probe()).rejects.toBeInstanceOf(TRPCError);
      }
    }
  });
});
