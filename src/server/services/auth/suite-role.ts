/**
 * Suite-wide coarse role for co-deployed suite apps (CHAD).
 *
 * Stamped into the VF session JWT as the `suite_role` claim on every mint
 * path (credentials/OIDC/webauthn via auth.ts's jwt callback, SAML via
 * buildSamlSessionCookie). CHAD decodes the shared session cookie in
 * delegated-auth mode and maps: admin->admin, editor->analyst, viewer->viewer.
 *
 * Mapping (fixed contract):
 *   org OWNER/ADMIN            -> "admin"
 *   else any team EDITOR/ADMIN -> "editor"
 *   else                       -> "viewer"
 */
import { prisma } from "@/lib/prisma";

export type SuiteRole = "admin" | "editor" | "viewer";

const ORG_ADMIN_ROLES = new Set(["OWNER", "ADMIN"]);
const TEAM_EDITOR_ROLES = new Set(["EDITOR", "ADMIN"]);

export function computeSuiteRole(
  orgRole: string | null | undefined,
  teamRoles: readonly string[],
): SuiteRole {
  if (orgRole && ORG_ADMIN_ROLES.has(orgRole)) return "admin";
  if (teamRoles.some((role) => TEAM_EDITOR_ROLES.has(role))) return "editor";
  return "viewer";
}

/**
 * Fetch the user's OrgMember role (for this org) and all TeamMember roles,
 * then reduce them with computeSuiteRole. Called at interactive sign-in
 * time only (jwt callback with `user` present; SAML cookie mint), never on
 * token refresh, so a role change takes effect on the next login or at the
 * 24h session expiry — matching the suite design's staleness budget.
 */
export async function resolveSuiteRole(
  userId: string,
  orgId: string,
): Promise<SuiteRole> {
  const [orgMember, teamMemberships] = await Promise.all([
    prisma.orgMember.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      select: { role: true },
    }),
    prisma.teamMember.findMany({
      where: { userId },
      select: { role: true },
    }),
  ]);
  return computeSuiteRole(
    orgMember?.role,
    teamMemberships.map((m) => m.role),
  );
}
