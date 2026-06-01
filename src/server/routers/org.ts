/**
 * Organisation-level OrgMember management.
 *
 * Tenant-scoped: every procedure operates on the caller's resolved
 * `ctx.organizationId`. Strictly OWNER-gated where the operation is
 * destructive (ownership transfer, member promotion).
 *
 * Procedures:
 *
 *   - `transferOwnership({ toUserId })` — atomic OWNER → ADMIN demotion
 *     of the caller plus ADMIN/MEMBER → OWNER promotion of the target.
 *     Caller MUST be the current OWNER and MUST NOT target themselves.
 *     The target MUST already be an OrgMember (invite first if not).
 *
 * Notes:
 *   - Wraps both updates in a single `$transaction` so an org is never
 *     left ownerless or double-owned mid-flight.
 *   - Uses `withOrgTx` to set `app.org_id` so the strict-RLS profile
 *     sees the rows under the non-owner Postgres role.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { denyInDemo, protectedProcedure, router } from "@/trpc/init";
import { withAudit } from "@/server/middleware/audit";
import { withOrgTx } from "@/lib/with-org-tx";
import type { PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  DNS_VERIFICATION_PREFIX,
  TXT_VALUE_PREFIX,
  generateVerificationToken,
  normaliseDomain,
  verifyClaimViaDns,
  type DnsTxtResolver,
} from "@/server/services/auth/domain-claim";

/** Test seam: override the DNS resolver in unit tests. */
let dnsResolverOverride: DnsTxtResolver | null = null;
export function _setDomainClaimDnsResolverForTests(
  resolver: DnsTxtResolver | null,
): void {
  dnsResolverOverride = resolver;
}

const userIdSchema = z
  .string()
  .min(1, "User id is required")
  .max(64, "User id too long")
  .regex(/^[A-Za-z0-9_-]+$/, "User id must be url-safe alphanumeric");

export const orgRouter = router({
  /**
   * Read-only roster of OrgMembers for the caller's organisation.
   *
   * Powers the "Transfer ownership" UI on the org-level settings
   * surface. We deliberately scope by role: OWNER + ADMIN see the
   * whole roster so the OWNER can pick a successor; plain MEMBERs
   * cannot enumerate peers from this surface (the per-team listing
   * is the right place for that and it already exists on the team
   * router).
   *
   * Returns the minimum shape the transfer-ownership dialog needs to
   * disambiguate candidates: id, name, email, role, joinedAt. Nothing
   * encrypted or PII-heavy beyond what the team router already
   * surfaces.
   */
  listMembers: protectedProcedure.query(async ({ ctx }) => {
    const orgMemberRole = (ctx as { orgMemberRole?: string }).orgMemberRole;
    if (orgMemberRole !== "OWNER" && orgMemberRole !== "ADMIN") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Listing organisation members requires OWNER or ADMIN.",
      });
    }
    const rows = await prisma.orgMember.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        role: true,
        createdAt: true,
        userId: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      userId: r.userId,
      name: r.user.name,
      email: r.user.email,
      role: r.role,
      joinedAt: r.createdAt,
    }));
  }),

  /**
   * Atomically transfer OWNER from the caller to another existing
   * OrgMember of the same organisation.
   */
  transferOwnership: protectedProcedure
    .use(denyInDemo())
    .input(z.object({ toUserId: userIdSchema }))
    .use(withAudit("org.ownership_transferred", "Organization"))
    .mutation(async ({ input, ctx }) => {
      const orgMemberRole = (ctx as { orgMemberRole?: string }).orgMemberRole;
      if (orgMemberRole !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Only the current OWNER can transfer ownership of this organisation.",
        });
      }

      const fromUserId = ctx.session?.user?.id;
      if (!fromUserId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (fromUserId === input.toUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot transfer ownership to yourself.",
        });
      }

      const organizationId = ctx.organizationId;

      return withOrgTx(organizationId, async (rawTx) => {
        const tx = rawTx as unknown as PrismaClient;

        // The target MUST already be a member; we don't auto-invite —
        // an auto-invite from this surface would let an OWNER promote
        // an arbitrary email address to OWNER without their consent.
        const target = await tx.orgMember.findUnique({
          where: {
            userId_organizationId: {
              userId: input.toUserId,
              organizationId,
            },
          },
          select: { id: true, role: true },
        });
        if (!target) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Target user is not a member of this organisation. Invite them first.",
          });
        }

        // Belt-and-braces: re-read the caller's membership inside the
        // transaction. The context value is set at request start, but the
        // OWNER row could have been demoted between then and now.
        const self = await tx.orgMember.findUnique({
          where: {
            userId_organizationId: { userId: fromUserId, organizationId },
          },
          select: { role: true },
        });
        if (!self || self.role !== "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are no longer the OWNER of this organisation.",
          });
        }

        await tx.orgMember.update({
          where: {
            userId_organizationId: { userId: fromUserId, organizationId },
          },
          data: { role: "ADMIN" },
        });
        await tx.orgMember.update({
          where: {
            userId_organizationId: { userId: input.toUserId, organizationId },
          },
          data: { role: "OWNER" },
        });

        // Returning the entity-id-shaped object lets `withAudit` log the
        // OrganizationId as the audited entity.
        return {
          id: organizationId,
          fromUserId,
          toUserId: input.toUserId,
        };
      });
    }),

  /**
   * Begin a DNS-TXT domain ownership claim. Mints a fresh
   * `verificationToken` and returns the TXT record the customer must
   * publish before calling `verifyDomain`.
   *
   * Idempotent on `(organizationId, domain)`: claiming the same domain
   * twice rotates the token (the previous TXT record stops working
   * immediately) and clears any prior `verifiedAt`. This is the right
   * shape — if a customer is re-claiming, they expect the new token to
   * be the one that verifies, not the stale one.
   */
  claimDomain: protectedProcedure
    .use(denyInDemo())
    .input(z.object({ domain: z.string().min(3).max(253) }))
    .use(withAudit("org.domain_claim_started", "OrganizationDomainClaim"))
    .mutation(async ({ input, ctx }) => {
      const orgMemberRole = (ctx as { orgMemberRole?: string }).orgMemberRole;
      if (orgMemberRole !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Claiming a domain requires an org OWNER.",
        });
      }

      let domain: string;
      try {
        domain = normaliseDomain(input.domain);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (err as Error).message,
        });
      }

      const organizationId = ctx.organizationId;
      const verificationToken = generateVerificationToken();

      const claim = await prisma.organizationDomainClaim.upsert({
        where: {
          organizationId_domain: { organizationId, domain },
        },
        create: {
          organizationId,
          domain,
          verificationToken,
        },
        update: {
          verificationToken,
          // Rotating the token invalidates the prior verification.
          verifiedAt: null,
          lastCheckedAt: null,
          lastCheckError: null,
        },
      });

      return {
        id: claim.id,
        organizationId: claim.organizationId,
        domain: claim.domain,
        verificationToken: claim.verificationToken,
        instructions: {
          host: `${DNS_VERIFICATION_PREFIX}.${claim.domain}`,
          type: "TXT" as const,
          value: `${TXT_VALUE_PREFIX}${claim.verificationToken}`,
        },
      };
    }),

  /**
   * Re-run the DNS TXT lookup for a pending claim. Sets `verifiedAt`
   * if the lookup succeeds; otherwise records `lastCheckError` and
   * leaves `verifiedAt` untouched (NULL or a prior success).
   *
   * Refuses to mark a domain verified for *this* org if another org
   * already holds a verified claim on the same name — that invariant
   * is enforced here because Prisma's schema language doesn't express
   * a partial unique index in this version.
   */
  verifyDomain: protectedProcedure
    .use(denyInDemo())
    .input(z.object({ id: z.string().min(1).max(64) }))
    .use(withAudit("org.domain_verification_attempted", "OrganizationDomainClaim"))
    .mutation(async ({ input, ctx }) => {
      const orgMemberRole = (ctx as { orgMemberRole?: string }).orgMemberRole;
      if (orgMemberRole !== "OWNER" && orgMemberRole !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Verifying a domain claim requires an org OWNER or ADMIN.",
        });
      }

      const organizationId = ctx.organizationId;
      const claim = await prisma.organizationDomainClaim.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          organizationId: true,
          domain: true,
          verificationToken: true,
        },
      });
      if (!claim || claim.organizationId !== organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const result = await verifyClaimViaDns(
        { domain: claim.domain, verificationToken: claim.verificationToken },
        dnsResolverOverride ?? undefined,
      );
      const now = new Date();
      if (!result.ok) {
        const updated = await prisma.organizationDomainClaim.update({
          where: { id: claim.id },
          data: {
            lastCheckedAt: now,
            lastCheckError: result.error,
          },
          select: { id: true, verifiedAt: true, lastCheckError: true },
        });
        return { id: updated.id, verified: false, error: result.error };
      }

      // Cross-org uniqueness for verified claims is enforced atomically
      // by the `OrganizationDomainClaim_domain_verified_unique` partial
      // unique index (see migration 20260519000003). A non-atomic
      // findFirst-then-update would leave a TOCTOU window where two
      // concurrent verifyDomain calls for the same `domain` in different
      // orgs both pass the conflict check and both proceed to update.
      //
      // The findFirst probe remains as a soft pre-check so the common
      // happy path returns a clear CONFLICT error without relying on
      // catching a Prisma error. The try/catch below is the load-bearing
      // enforcement.
      const conflict = await prisma.organizationDomainClaim.findFirst({
        where: {
          domain: claim.domain,
          verifiedAt: { not: null },
          NOT: { id: claim.id },
        },
        select: { id: true, organizationId: true },
      });
      if (conflict) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another organisation has already verified this domain.",
        });
      }

      let updated;
      try {
        updated = await prisma.organizationDomainClaim.update({
          where: { id: claim.id },
          data: {
            verifiedAt: now,
            lastCheckedAt: now,
            lastCheckError: null,
          },
          select: { id: true, verifiedAt: true },
        });
      } catch (err) {
        // Prisma surfaces partial-unique-index violations as P2002 with
        // target = ["domain"] (the constraint name in the index above).
        // A racing concurrent verifyDomain for another org won this race.
        const code = (err as { code?: string } | undefined)?.code;
        if (code === "P2002") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another organisation has already verified this domain.",
          });
        }
        throw err;
      }
      return { id: updated.id, verified: true };
    }),

  /**
   * List all domain claims (verified + unverified) for the caller's
   * organisation. OWNER + ADMIN can read; MEMBER cannot.
   */
  listDomains: protectedProcedure
    .query(async ({ ctx }) => {
      const orgMemberRole = (ctx as { orgMemberRole?: string }).orgMemberRole;
      if (orgMemberRole !== "OWNER" && orgMemberRole !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Listing domain claims requires an org OWNER or ADMIN.",
        });
      }
      const claims = await prisma.organizationDomainClaim.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          domain: true,
          verificationToken: true,
          verifiedAt: true,
          lastCheckedAt: true,
          lastCheckError: true,
          createdAt: true,
        },
      });
      // Expose the DNS-TXT instructions for still-pending claims so the
      // claimant can finish verification after a reload / on another device
      // without re-claiming (which rotates the token and invalidates any
      // record they already published). The token IS the public DNS value,
      // so surfacing it to an org OWNER/ADMIN is not a secret leak.
      return claims.map(({ verificationToken, ...claim }) => ({
        ...claim,
        instructions: claim.verifiedAt
          ? null
          : {
              host: `${DNS_VERIFICATION_PREFIX}.${claim.domain}`,
              type: "TXT" as const,
              value: `${TXT_VALUE_PREFIX}${verificationToken}`,
            },
      }));
    }),

  /**
   * Delete a domain claim. OWNER-only — un-claiming a verified domain
   * disables downstream policies attached to it (OIDC routing, magic-
   * link allow-listing, etc.).
   */
  unclaimDomain: protectedProcedure
    .use(denyInDemo())
    .input(z.object({ id: z.string().min(1).max(64) }))
    .use(withAudit("org.domain_claim_removed", "OrganizationDomainClaim"))
    .mutation(async ({ input, ctx }) => {
      const orgMemberRole = (ctx as { orgMemberRole?: string }).orgMemberRole;
      if (orgMemberRole !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Removing a domain claim requires an org OWNER.",
        });
      }
      const claim = await prisma.organizationDomainClaim.findUnique({
        where: { id: input.id },
        select: { id: true, organizationId: true },
      });
      if (!claim || claim.organizationId !== ctx.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await prisma.organizationDomainClaim.delete({ where: { id: claim.id } });
      return { id: claim.id, removed: true };
    }),

  /**
   * Peer-OWNER authenticator reset (TOTP + passkeys).
   *
   * Audit gap C.5 / Lane 8a — `resetMemberMfa` originally cleared
   * TOTP only. An OWNER who lost their passkey was still locked out
   * because no peer-OWNER could drop the WebAuthn credentials. This
   * procedure now blanks BOTH factors atomically:
   *
   *   - `User.totpEnabled / totpSecret / totpBackupCodes` cleared
   *   - `WebAuthnCredential` rows for the target deleted
   *   - `WebAuthnChallenge` rows for the target deleted
   *
   * The recovered user re-enrols TOTP and/or a passkey on next sign-in.
   *
   * Constraints (unchanged from the TOTP-only original):
   *   - Caller MUST be `OrgMember.role === "OWNER"`. Peer recovery
   *     between two ADMINs is intentionally NOT allowed.
   *   - Caller MUST NOT be the target (no self-rescue).
   *   - Target MUST be an OrgMember of the caller's organisation.
   *
   * Single-OWNER orgs have no peer to invoke this; recovery requires
   * a privileged operator (a platform-operator account with the
   * appropriate role) or a direct DB update.
   */
  resetMemberAuth: protectedProcedure
    .use(denyInDemo())
    .input(z.object({ targetUserId: userIdSchema }))
    .use(withAudit("org.member_auth_reset", "User"))
    .mutation(async ({ input, ctx }) => {
      const orgMemberRole = (ctx as { orgMemberRole?: string }).orgMemberRole;
      if (orgMemberRole !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Resetting another member's authenticators requires an org OWNER.",
        });
      }
      const callerId = ctx.session?.user?.id;
      if (!callerId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      if (callerId === input.targetUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "You cannot reset your own authenticators from this surface. Use a backup code at sign-in.",
        });
      }

      const organizationId = ctx.organizationId;
      return withOrgTx(organizationId, async (rawTx) => {
        const tx = rawTx as unknown as PrismaClient;

        const targetMembership = await tx.orgMember.findUnique({
          where: {
            userId_organizationId: {
              userId: input.targetUserId,
              organizationId,
            },
          },
          select: { id: true },
        });
        if (!targetMembership) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Target user is not a member of this organisation.",
          });
        }

        const target = await tx.user.findUnique({
          where: { id: input.targetUserId },
          select: { id: true, totpEnabled: true },
        });
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // Snapshot the WebAuthn credential count BEFORE deletion so
        // the audit row carries it (factorsReset metadata).
        const webAuthnBefore = await tx.webAuthnCredential.count({
          where: { userId: target.id },
        });

        await tx.user.update({
          where: { id: target.id },
          data: {
            totpEnabled: false,
            totpSecret: null,
            totpBackupCodes: null,
          },
        });
        await tx.webAuthnCredential.deleteMany({
          where: { userId: target.id },
        });
        await tx.webAuthnChallenge.deleteMany({
          where: { userId: target.id },
        });

        // Codex PR #379 P2 — `withAudit` only persists the input
        // and a `timestamp` by default. The reset's outcome
        // (which factors were cleared, how many WebAuthn rows
        // disappeared) is the load-bearing data for a future
        // compliance review. Hand it to the middleware via
        // `ctx.auditMetadata` so the audit row's metadata column
        // carries the receipts. Pattern is shared with
        // pipeline-graph.ts.
        (ctx as Record<string, unknown>).auditMetadata = {
          targetUserId: target.id,
          wasTotpEnabled: target.totpEnabled,
          webAuthnCredentialsRemoved: webAuthnBefore,
          factorsReset: ["totp", "webauthn"],
        };

        // Return the User entity-id so withAudit logs the correct row.
        return {
          id: target.id,
          targetUserId: target.id,
          wasTotpEnabled: target.totpEnabled,
          webAuthnCredentialsRemoved: webAuthnBefore,
          factorsReset: ["totp", "webauthn"] as const,
        };
      });
    }),

  /**
   * @deprecated Back-compat alias for {@link resetMemberAuth}. Existing
   * UI buttons / callers may still target `resetMemberMfa`; new code
   * SHOULD use `resetMemberAuth`. Remove after one release cycle.
   *
   * The implementation is intentionally a thin call-through so any
   * audit-log consumer sees the new action name (`org.member_auth_reset`)
   * regardless of which entry point fired.
   */
  resetMemberMfa: protectedProcedure
    .use(denyInDemo())
    .input(z.object({ targetUserId: userIdSchema }))
    .use(withAudit("org.member_auth_reset", "User"))
    .mutation(async ({ input, ctx }) => {
      const orgMemberRole = (ctx as { orgMemberRole?: string }).orgMemberRole;
      if (orgMemberRole !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Resetting another member's authenticators requires an org OWNER.",
        });
      }
      const callerId = ctx.session?.user?.id;
      if (!callerId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      if (callerId === input.targetUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "You cannot reset your own authenticators from this surface. Use a backup code at sign-in.",
        });
      }

      const organizationId = ctx.organizationId;
      return withOrgTx(organizationId, async (rawTx) => {
        const tx = rawTx as unknown as PrismaClient;

        const targetMembership = await tx.orgMember.findUnique({
          where: {
            userId_organizationId: {
              userId: input.targetUserId,
              organizationId,
            },
          },
          select: { id: true },
        });
        if (!targetMembership) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Target user is not a member of this organisation.",
          });
        }

        const target = await tx.user.findUnique({
          where: { id: input.targetUserId },
          select: { id: true, totpEnabled: true },
        });
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const webAuthnBefore = await tx.webAuthnCredential.count({
          where: { userId: target.id },
        });

        await tx.user.update({
          where: { id: target.id },
          data: {
            totpEnabled: false,
            totpSecret: null,
            totpBackupCodes: null,
          },
        });
        await tx.webAuthnCredential.deleteMany({
          where: { userId: target.id },
        });
        await tx.webAuthnChallenge.deleteMany({
          where: { userId: target.id },
        });

        // See `resetMemberAuth` above — pass metadata to withAudit
        // via ctx so the audit row carries the factorsReset receipts.
        (ctx as Record<string, unknown>).auditMetadata = {
          targetUserId: target.id,
          wasTotpEnabled: target.totpEnabled,
          webAuthnCredentialsRemoved: webAuthnBefore,
          factorsReset: ["totp", "webauthn"],
          via: "resetMemberMfa-alias",
        };

        return {
          id: target.id,
          targetUserId: target.id,
          wasEnabled: target.totpEnabled,
          wasTotpEnabled: target.totpEnabled,
          webAuthnCredentialsRemoved: webAuthnBefore,
          factorsReset: ["totp", "webauthn"] as const,
        };
      });
    }),
});
