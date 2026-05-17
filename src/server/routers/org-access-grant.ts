/**
 * Customer-admin OrgAccessGrant router (plan §5 break-glass workflow).
 *
 * This is the customer half of the break-glass flow. The operator
 * side opens / revokes grants via the operator console
 * (`vectorflow-cloud:cloud/src/server/routers/operator-console.ts`);
 * this router lets the customer's OWNER / ADMIN approve them.
 *
 * Procedures:
 *
 *   - `list({ status? })` — pending + recently-resolved grants for the
 *     caller's org. OWNER + ADMIN role on the OrgMember.
 *   - `approve({ grantId })` — customer-admin approves a pending
 *     grant. Sets `approvedByCustomerAdminId` + writes an `AuditLog`
 *     row. OWNER + ADMIN role on the OrgMember. The KMS grant token
 *     issuance is a Cloud-only follow-up (the OSS approval path
 *     records intent; the Cloud bootstrap mints the GrantToken on
 *     approval transition).
 *   - `revoke({ grantId })` — customer-admin revokes a grant before
 *     it expires (e.g. operator opened it for the wrong reason).
 *     OWNER role only — revocation is owner-scoped because it can
 *     interfere with incident response.
 *
 * Gating: each procedure wraps its DB work in `withOrgTx(orgId, ...)` so
 * `app.org_id` is set before touching any tenant table. This satisfies the
 * strict RLS policies added in 20260516000003_phase5a_rls_strict_policies;
 * without an org context, the non-owner app role sees no rows.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { router, protectedProcedure } from "@/trpc/init";
import { withOrgTx } from "@/lib/with-org-tx";
import { writeAuditLog } from "@/server/services/audit";
import type { PrismaClient } from "@/generated/prisma";
import {
  approveOrgAccessGrant,
  listOrgAccessGrantsForOrg,
} from "@/server/services/org-access-grant";

/**
 * Zod schema for organizationId. Mirrors `withOrgTx`'s validation so
 * malformed input is rejected with BAD_REQUEST before it reaches the DB.
 */
const organizationIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, {
  message: "organizationId must contain only alphanumeric characters, underscores, and hyphens",
});

/**
 * Narrow view of the Prisma client used inside `requireOrgRole`.
 * Accepts both the global `prisma` instance and the `tx` client
 * returned by `withOrgTx` (cast to `PrismaClient` — at runtime Prisma's
 * transaction callback IS a full client, but `withOrgTx.ts` types it
 * narrowly to `{ $executeRaw }` for simplicity).
 */
type MemberQueryClient = Pick<PrismaClient, "orgMember">;

type OrgMemberRoleLiteral = "OWNER" | "ADMIN" | "MEMBER";

/**
 * Verify the caller has an OrgMember role at or above `minRole` in
 * the supplied org. Throws TRPCError if not.
 *
 * Must be called INSIDE a `withOrgTx` block so `app.org_id` is set
 * and the OrgMember row is visible under RLS.
 */
async function requireOrgRole(
  client: MemberQueryClient,
  userId: string | undefined,
  organizationId: string,
  minRole: "OWNER" | "ADMIN",
): Promise<OrgMemberRoleLiteral> {
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const member = await client.orgMember.findUnique({
    where: {
      userId_organizationId: { userId, organizationId },
    },
    select: {
      role: true,
      organization: { select: { suspendedAt: true, deletedAt: true } },
    },
  });
  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  }
  // Lifecycle check: deletion takes precedence over suspension (consistent
  // with src/lib/org-constraints.ts and src/trpc/init.ts).
  if (member.organization.deletedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  }
  if (member.organization.suspendedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization is suspended" });
  }
  const role = member.role as OrgMemberRoleLiteral;
  if (minRole === "OWNER" && role !== "OWNER") {
    throw new TRPCError({ code: "FORBIDDEN", message: "OWNER role required" });
  }
  if (minRole === "ADMIN" && role === "MEMBER") {
    throw new TRPCError({ code: "FORBIDDEN", message: "OWNER or ADMIN role required" });
  }
  return role;
}

export const orgAccessGrantRouter = router({
  /**
   * List grants visible to the caller's org. Customer admins see
   * pending grants they need to approve + a recent history (default
   * last 50 across pending/approved/revoked/expired).
   */
  list: protectedProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Wrap in withOrgTx so app.org_id is set for RLS before we read OrgMember.
      return withOrgTx(input.organizationId, async (_tx) => {
        // Cast: Prisma's tx callback IS a full PrismaClient at runtime.
        const tx = _tx as unknown as PrismaClient;
        await requireOrgRole(tx, ctx.session.user?.id, input.organizationId, "ADMIN");
        // Pass the tx so the service query runs inside the RLS-fenced transaction.
        return listOrgAccessGrantsForOrg(input.organizationId, {
          tx: tx as never,
          limit: input.limit,
        });
      });
    }),

  /**
   * Approve a pending grant. The operator-side request has already
   * been logged; this records customer-admin consent + writes an
   * `auth.grant_approved` audit row visible in the org's audit page.
   */
  approve: protectedProcedure
    .input(
      z.object({
        grantId: z.string(),
        organizationId: organizationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const approved = await withOrgTx(input.organizationId, async (_tx) => {
        const tx = _tx as unknown as PrismaClient;
        await requireOrgRole(tx, userId, input.organizationId, "ADMIN");

        // Pre-check: the grant must exist, belong to this org, be un-approved,
        // un-revoked, and not yet expired.
        const grant = await tx.orgAccessGrant.findUnique({
          where: { id: input.grantId },
          select: {
            id: true,
            organizationId: true,
            approvedByCustomerAdminId: true,
            revokedAt: true,
            expiresAt: true,
          },
        });
        if (!grant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Grant not found" });
        }
        if (grant.organizationId !== input.organizationId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Grant belongs to a different organization" });
        }
        if (grant.approvedByCustomerAdminId) {
          throw new TRPCError({ code: "CONFLICT", message: "Grant already approved" });
        }
        if (grant.revokedAt) {
          throw new TRPCError({ code: "CONFLICT", message: "Grant already revoked" });
        }
        if (grant.expiresAt && grant.expiresAt <= new Date()) {
          throw new TRPCError({ code: "CONFLICT", message: "Grant has expired" });
        }

        // Pass tx so the service query runs inside the RLS-fenced transaction.
        return approveOrgAccessGrant(
          { grantId: input.grantId, approvedByCustomerAdminId: userId },
          { tx: tx as never },
        );
      });

      // Write the chained audit row OUTSIDE withOrgTx so writeAuditLog's
      // advisory lock does not nest inside the grant transaction.
      writeAuditLog({
        organizationId: input.organizationId,
        userId,
        action: "auth.grant_approved",
        entityType: "OrgAccessGrant",
        entityId: input.grantId,
        metadata: {
          operatorId: approved.operatorId,
          expiresAt: approved.expiresAt.toISOString(),
        },
      }).catch(() => undefined);

      return approved;
    }),

  /**
   * Customer-admin revokes a grant. OWNER role only — revocation can
   * interrupt incident response.
   */
  revoke: protectedProcedure
    .input(
      z.object({
        grantId: z.string(),
        organizationId: organizationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const { revoked, didRevoke } = await withOrgTx(input.organizationId, async (_tx) => {
        const tx = _tx as unknown as PrismaClient;
        await requireOrgRole(tx, userId, input.organizationId, "OWNER");

        const grant = await tx.orgAccessGrant.findUnique({
          where: { id: input.grantId },
          select: { id: true, organizationId: true, revokedAt: true, operatorId: true },
        });
        if (!grant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Grant not found" });
        }
        if (grant.organizationId !== input.organizationId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Grant belongs to a different organization" });
        }
        if (grant.revokedAt) {
          throw new TRPCError({ code: "CONFLICT", message: "Grant already revoked" });
        }

        // Atomic revoke: use updateMany so `count > 0` definitively means
        // THIS call performed the revocation. The `revokedAt: null` guard
        // ensures a concurrent request that already revoked wins the race;
        // the loser sees count=0 and the subsequent CONFLICT check fires.
        const now = new Date();
        const { count } = await tx.orgAccessGrant.updateMany({
          where: { id: input.grantId, revokedAt: null },
          data: { revokedAt: now },
        });

        if (count === 0) {
          // Lost the race — another request already revoked this grant.
          throw new TRPCError({ code: "CONFLICT", message: "Grant already revoked by a concurrent request" });
        }

        const revoked = await tx.orgAccessGrant.findUniqueOrThrow({
          where: { id: input.grantId },
        });

        return { revoked: revoked as import("@/server/services/org-access-grant").OrgAccessGrantRow, didRevoke: true };
      });

      // Emit the revoke audit only when this call actually performed the revocation.
      if (didRevoke) {
        writeAuditLog({
          organizationId: input.organizationId,
          userId,
          action: "auth.grant_revoked",
          entityType: "OrgAccessGrant",
          entityId: input.grantId,
          metadata: { operatorId: revoked.operatorId },
        }).catch(() => undefined);
      }

      return revoked;
    }),
});
