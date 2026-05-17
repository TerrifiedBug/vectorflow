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
 * Gating: every procedure runs through `orgProcedure` so the
 * `app.org_id` is set inside the transaction. The membership-role
 * check is layered on top.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import {
  approveOrgAccessGrant,
  revokeOrgAccessGrant,
  listOrgAccessGrantsForOrg,
} from "@/server/services/org-access-grant";

type OrgMemberRoleLiteral = "OWNER" | "ADMIN" | "MEMBER";

/**
 * Verify the caller has an OrgMember role at or above `minRole` in
 * the supplied org. Throws TRPCError if not.
 */
async function requireOrgRole(
  userId: string | undefined,
  organizationId: string,
  minRole: "OWNER" | "ADMIN",
): Promise<OrgMemberRoleLiteral> {
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const member = await prisma.orgMember.findUnique({
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
  // Lifecycle check: grants cannot be managed for suspended or deleted orgs.
  if (member.organization.suspendedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization is suspended" });
  }
  if (member.organization.deletedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
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
        organizationId: z.string(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireOrgRole(ctx.session.user?.id, input.organizationId, "ADMIN");
      return listOrgAccessGrantsForOrg(input.organizationId, {
        limit: input.limit,
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
        organizationId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user?.id;
      await requireOrgRole(userId, input.organizationId, "ADMIN");
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      // Pre-check: the grant must exist and belong to this org. The
      // service `approveOrgAccessGrant` doesn't take orgId — we
      // verify here so a malicious caller cannot approve a grant from
      // a different org by knowing its id.
      const grant = await prisma.orgAccessGrant.findUnique({
        where: { id: input.grantId },
        select: { id: true, organizationId: true, approvedByCustomerAdminId: true, revokedAt: true },
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

      const approved = await approveOrgAccessGrant({
        grantId: input.grantId,
        approvedByCustomerAdminId: userId,
      });

      // Customer-side audit row — visible in the org's audit page.
      // The operator-side PlatformAuditLog entry is written by the
      // Cloud break-glass middleware at grant-use time.
      await prisma.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId,
          action: "auth.grant_approved",
          entityType: "OrgAccessGrant",
          entityId: input.grantId,
          metadata: {
            operatorId: approved.operatorId,
            expiresAt: approved.expiresAt.toISOString(),
          },
        },
      });

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
        organizationId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user?.id;
      await requireOrgRole(userId, input.organizationId, "OWNER");
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const grant = await prisma.orgAccessGrant.findUnique({
        where: { id: input.grantId },
        select: { id: true, organizationId: true, revokedAt: true },
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

      const revoked = await revokeOrgAccessGrant(input.grantId);

      await prisma.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId,
          action: "auth.grant_revoked",
          entityType: "OrgAccessGrant",
          entityId: input.grantId,
          metadata: { operatorId: revoked.operatorId },
        },
      });

      return revoked;
    }),
});
