/**
 * Org-wide admin check — the post-`isSuperAdmin` semantic.
 *
 * Background:
 *   `User.isSuperAdmin` was a global boolean that broadened query scope
 *   to "see every team in the installation". In a multi-tenant model
 *   that semantic must be re-grounded against an organisation; an
 *   operator-style "see everything" privilege belongs in
 *   `PlatformOperator`, not `User`. This helper returns the org-scoped
 *   equivalent: "this user is an OWNER or ADMIN of this organisation".
 *
 * Migration (complete, slice 7c):
 *   The legacy `User.isSuperAdmin` column has been dropped. Every reader
 *   uses `isOrgWideAdmin(userId, ctx.organizationId)`; the deprecated
 *   `requireSuperAdmin()` middleware was removed alongside the column.
 *
 * Single-tenant OSS installs are unaffected: the install bootstrap
 * (`setup.ts`) creates the first user as OWNER of `DEFAULT_ORG_ID`,
 * which satisfies this check without any data backfill.
 */
import { prisma } from "@/lib/prisma";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";

/** Roles considered "org-wide admin" — OWNER and ADMIN; MEMBER is not. */
const ORG_ADMIN_ROLES = new Set(["OWNER", "ADMIN"]);

/**
 * True when the user has OrgMember role OWNER or ADMIN in the named
 * organisation. False otherwise (non-member, MEMBER role, or missing
 * user).
 */
export async function isOrgWideAdmin(
  userId: string | null | undefined,
  organizationId: string = DEFAULT_ORG_ID,
): Promise<boolean> {
  if (!userId) return false;
  const member = await prisma.orgMember.findUnique({
    where: {
      userId_organizationId: { userId, organizationId },
    },
    select: { role: true },
  });
  return !!member && ORG_ADMIN_ROLES.has(member.role);
}
