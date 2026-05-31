/**
 * VF-18: withTeamAccess must be able to resolve team context for procedures
 * that supply only a rolloutId / jobId / deliveryAttemptId. Before the fix the
 * resolver had no branch for these keys, so it always threw
 * "Cannot resolve team context from input" and the procedures
 * (stagedRollout.broaden/rollback, gitSync.retryJob, alert.retryDelivery) were
 * permanently broken in production.
 *
 * These tests exercise the REAL resolver (no passthrough mock of withTeamAccess).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

vi.mock("@/lib/org-admin", () => ({
  isOrgWideAdmin: vi.fn(),
}));

// Importing @/trpc/init pulls in @/auth (next-auth -> next/server), which does
// not resolve under vitest; stub it (and next/headers) so we exercise only the
// real withTeamAccess resolver.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map<string, string>()),
}));

import { prisma } from "@/lib/prisma";
import { isOrgWideAdmin } from "@/lib/org-admin";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { z } from "zod";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const orgAdminMock = isOrgWideAdmin as unknown as ReturnType<typeof vi.fn>;

const testRouter = router({
  byRollout: protectedProcedure
    .input(z.object({ rolloutId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(({ ctx }) => ({ resolvedTeamId: ctx.teamId })),
  byJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(({ ctx }) => ({ resolvedTeamId: ctx.teamId })),
  byDeliveryAttempt: protectedProcedure
    .input(z.object({ deliveryAttemptId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(({ ctx }) => ({ resolvedTeamId: ctx.teamId })),
});

function makeCaller() {
  // The org-wide-admin path returns ADMIN role and skips the per-team membership
  // lookup — simplest way to assert the resolver found a team.
  return testRouter.createCaller({
    session: { user: { id: "user-1", email: "u@test.com" } },
    organizationId: "default",
  } as never);
}

describe("withTeamAccess resolver (VF-18)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    orgAdminMock.mockReset();
    // Treat the caller as an org-wide admin so the resolver, once it finds a
    // teamId, lets the call through without a teamMember lookup.
    orgAdminMock.mockResolvedValue(true);
    // Org-boundary check fetches the team's org; default org skips the check
    // but team.findUnique is still awaited.
    prismaMock.team.findUnique.mockResolvedValue({ organizationId: "default" } as never);
  });

  it("resolves teamId from rolloutId (StagedRollout)", async () => {
    prismaMock.stagedRollout.findUnique.mockResolvedValue({
      environment: { teamId: "team-rollout" },
    } as never);

    const res = await makeCaller().byRollout({ rolloutId: "ro-1" });
    expect(res.resolvedTeamId).toBe("team-rollout");
    expect(prismaMock.stagedRollout.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ro-1" } }),
    );
  });

  it("resolves teamId from jobId (GitSyncJob)", async () => {
    prismaMock.gitSyncJob.findUnique.mockResolvedValue({
      environment: { teamId: "team-job" },
    } as never);

    const res = await makeCaller().byJob({ jobId: "job-1" });
    expect(res.resolvedTeamId).toBe("team-job");
  });

  it("resolves teamId from deliveryAttemptId (DeliveryAttempt -> AlertRule)", async () => {
    prismaMock.deliveryAttempt.findUnique.mockResolvedValue({
      alertEvent: { alertRule: { teamId: "team-alert" } },
    } as never);

    const res = await makeCaller().byDeliveryAttempt({ deliveryAttemptId: "da-1" });
    expect(res.resolvedTeamId).toBe("team-alert");
  });

  it("still throws BAD_REQUEST when a rolloutId resolves to no rollout", async () => {
    prismaMock.stagedRollout.findUnique.mockResolvedValue(null);

    await expect(makeCaller().byRollout({ rolloutId: "missing" })).rejects.toThrow(
      /Cannot resolve team context/i,
    );
  });
});
