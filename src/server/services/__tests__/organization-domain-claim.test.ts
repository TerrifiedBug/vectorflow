/**
 * Focused test: partial-unique index enforcement for OrganizationDomainClaim.
 *
 * The cross-org "no two organisations may hold a verified claim on the same
 * domain" invariant is enforced atomically by the partial unique index
 * `OrganizationDomainClaim_domain_verified_unique` (WHERE "verifiedAt" IS NOT
 * NULL) created in migration 20260519000003_organization_domain_claim.
 *
 * Because Prisma's schema language does not express conditional unique indexes
 * at this version, the constraint lives in raw SQL.  The router's
 * `verifyDomain` handler performs a soft pre-check (`findFirst`) to surface a
 * clean CONFLICT error on the common path, but the TOCTOU window between that
 * probe and the subsequent `update` is closed by the DB constraint.  When two
 * concurrent calls both pass the soft check, the slower writer gets a P2002
 * from Postgres; the handler catches it and throws a CONFLICT TRPCError.
 *
 * These tests exercise that exact path so any future refactor of the catch
 * block regresses visibly.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Infrastructure mocks (must be hoisted before any import that resolves them)
// ---------------------------------------------------------------------------

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(
      ({
        next,
        ctx,
      }: {
        next: (opts: { ctx: unknown }) => unknown;
        ctx: unknown;
      }) => next({ ctx }),
    );
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

const auditMocks = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));
vi.mock("@/server/services/audit", () => ({
  writeAuditLog: auditMocks.writeAuditLog,
}));

// ---------------------------------------------------------------------------
// Module imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/prisma";
import { orgRouter, _setDomainClaimDnsResolverForTests } from "@/server/routers/org";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const callerFactory = t.createCallerFactory(orgRouter);

/** A verified-owner caller for org-a. */
function ownerCaller() {
  return callerFactory({
    session: { user: { id: "owner-1", email: "owner@example.test" } },
    organizationId: "org-a",
    orgMemberRole: "OWNER",
  });
}

/** Stub the DNS resolver to return the expected TXT records. */
function stubResolverWithToken(token: string) {
  _setDomainClaimDnsResolverForTests({
    resolveTxt: async () => [[`vf-verify=${token}`]],
  });
}

/** Prisma error shaped like a P2002 unique-constraint violation. */
function p2002(): Error {
  return Object.assign(new Error("Unique constraint failed on the fields: (`domain`)"), {
    code: "P2002",
    meta: { target: ["domain"] },
  });
}

const baseClaimRow = {
  id: "claim-1",
  organizationId: "org-a",
  domain: "acme.example",
  verificationToken: "tok-abc123",
};

beforeEach(() => {
  mockReset(prismaMock);
  _setDomainClaimDnsResolverForTests(null);
  auditMocks.writeAuditLog.mockReset();
  auditMocks.writeAuditLog.mockResolvedValue(undefined);
  // Default transaction passthrough.
  prismaMock.$executeRaw.mockResolvedValue(1 as never);
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prismaMock),
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrganizationDomainClaim — partial-unique index enforcement", () => {
  /**
   * Happy path: soft pre-check passes and DB update succeeds.
   * Included here so the file is self-contained and future regressions
   * are easy to bisect.
   */
  it("returns verified=true when DNS matches and no other org holds a verified claim", async () => {
    prismaMock.organizationDomainClaim.findUnique.mockResolvedValue(
      baseClaimRow as never,
    );
    // Soft pre-check: no conflict found.
    prismaMock.organizationDomainClaim.findFirst.mockResolvedValue(null);
    prismaMock.organizationDomainClaim.update.mockResolvedValue({
      id: "claim-1",
      verifiedAt: new Date(),
    } as never);
    stubResolverWithToken("tok-abc123");

    const result = await ownerCaller().verifyDomain({ id: "claim-1" });

    expect(result).toEqual({ id: "claim-1", verified: true });
  });

  /**
   * Soft pre-check detects a pre-existing verified claim held by another org
   * (the common path — no race involved).
   */
  it("throws CONFLICT when the soft pre-check finds another org already owns the domain", async () => {
    prismaMock.organizationDomainClaim.findUnique.mockResolvedValue(
      baseClaimRow as never,
    );
    prismaMock.organizationDomainClaim.findFirst.mockResolvedValue({
      id: "claim-other",
      organizationId: "org-b",
    } as never);
    stubResolverWithToken("tok-abc123");

    await expect(
      ownerCaller().verifyDomain({ id: "claim-1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  /**
   * Race condition: both callers pass the soft pre-check (findFirst returns
   * null for both) but the slower writer's DB update collides with the partial
   * unique index `OrganizationDomainClaim_domain_verified_unique` and Prisma
   * surfaces P2002.
   *
   * The router MUST catch P2002 and re-throw as TRPCError CONFLICT.  Without
   * this catch the raw Prisma error would propagate as an opaque
   * INTERNAL_SERVER_ERROR.
   */
  it("throws CONFLICT when the DB update races the partial-unique index (P2002)", async () => {
    prismaMock.organizationDomainClaim.findUnique.mockResolvedValue(
      baseClaimRow as never,
    );
    // Soft pre-check passes (concurrent winner hasn't committed yet).
    prismaMock.organizationDomainClaim.findFirst.mockResolvedValue(null);
    // The update hits the partial unique index after the winner commits.
    prismaMock.organizationDomainClaim.update.mockRejectedValueOnce(
      p2002() as never,
    );
    stubResolverWithToken("tok-abc123");

    await expect(
      ownerCaller().verifyDomain({ id: "claim-1" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/another organisation/i),
    });
  });

  /**
   * Non-P2002 DB errors must NOT be swallowed — only the unique-violation
   * gets the CONFLICT treatment.  Any other error re-throws and becomes an
   * INTERNAL_SERVER_ERROR at the tRPC boundary.
   */
  it("re-throws non-P2002 DB errors without mapping them to CONFLICT", async () => {
    prismaMock.organizationDomainClaim.findUnique.mockResolvedValue(
      baseClaimRow as never,
    );
    prismaMock.organizationDomainClaim.findFirst.mockResolvedValue(null);
    const connectionError = Object.assign(new Error("Connection lost"), {
      code: "P1001",
    });
    prismaMock.organizationDomainClaim.update.mockRejectedValueOnce(
      connectionError as never,
    );
    stubResolverWithToken("tok-abc123");

    // The raw DB error propagates — tRPC wraps it as INTERNAL_SERVER_ERROR,
    // but crucially the code is NOT CONFLICT (we didn't over-classify it).
    const err = await ownerCaller()
      .verifyDomain({ id: "claim-1" })
      .catch((e: unknown) => e);

    expect(err).toBeDefined();
    expect((err as { code?: string }).code).not.toBe("CONFLICT");
  });
});
