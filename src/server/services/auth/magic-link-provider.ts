/**
 * Magic-link NextAuth provider.
 *
 * Wraps `@/server/services/auth/magic-link`'s `consumeMagicLink`
 * primitive in a Credentials-style provider so
 * `signIn("magic-link", { token, organizationId })` works after the
 * user clicks the email link.
 *
 * Flow:
 *
 *   1. Browser POSTs to `/api/auth/magic-link/request` with
 *      `{ email }` → server resolves the org from the request host,
 *      calls `mintMagicLink`, sends the email containing
 *      `${baseUrl}/api/auth/magic-link/redeem?token=...`.
 *   2. User clicks the email link → the redeem route invokes
 *      `signIn("magic-link", { token, organizationId })` on the
 *      browser, which calls this provider's `authorize`.
 *   3. `authorize` calls `consumeMagicLink`; on success, find-or-
 *      creates the User by email and returns the NextAuth user.
 *
 * Find-or-create: magic-link doubles as a first-time signup primitive
 * for signup. The provider creates a User row with
 * `authMethod = "MAGIC_LINK"` if no user exists for the verified
 * email. OrgMember linkage is the caller's responsibility — the
 * calling overlay handles the first-user-as-OWNER bootstrap.
 *
 * Replay defence: `consumeMagicLink` atomically flips `consumedAt`
 * inside the same transaction it reads the row, so a stolen-token +
 * race-redeem cannot both succeed.
 */

import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/prisma";
import { consumeMagicLink } from "@/server/services/auth/magic-link";
import { writeAuditLog } from "@/server/services/audit";
import { infoLog, warnLog } from "@/lib/logger";
import { resolveOrgIdFromHost } from "@/lib/host-to-org";

/**
 * Pure authorize function, exported so unit tests can exercise it
 * without going through next-auth's wrapping.
 */
export async function authorizeMagicLink(
  credentials: Record<string, unknown> | undefined,
  expectedOrganizationIdOverride?: string,
): Promise<{
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
} | null> {
  if (
    !credentials ||
    typeof credentials.token !== "string" ||
    credentials.token.length < 8
  ) {
    return null;
  }

  // The expected-org binding is the caller's responsibility. NextAuth-
  // wired callers go through `authorizeMagicLinkFromRequest` (defined
  // below) which derives the org from the request host before calling
  // this helper. Unit tests pass an explicit override. Either way the
  // value is NEVER read from client-supplied credentials, so a token
  // captured for org A cannot be redeemed by POSTing directly to
  // `/api/auth/callback/magic-link` from org B.
  if (!expectedOrganizationIdOverride) {
    warnLog(
      "magic-link-provider",
      "magic-link authorize called without an expected organisation id; refusing redeem",
    );
    return null;
  }
  const expectedOrganizationId = expectedOrganizationIdOverride;

  let result: Awaited<ReturnType<typeof consumeMagicLink>>;
  try {
    result = await consumeMagicLink({
      token: credentials.token,
      expectedOrganizationId,
    });
  } catch (err) {
    warnLog("magic-link-provider", "consumeMagicLink threw", err);
    return null;
  }

  if (!result.ok) {
    // Reasons: not_found | already_used | expired | wrong_organization.
    // We don't surface the reason — a generic null preserves the
    // standard credential-failure NextAuth flow.
    return null;
  }

  // Find-or-create the User by verified email.
  // Use case-insensitive lookup first: `User.email` is a TEXT UNIQUE key
  // (case-sensitive in Postgres) but some sign-up flows may store addresses
  // with different casing. A case-insensitive scan prevents duplicate-account
  // creation for the same mailbox.
  let user = await prisma.user.findFirst({
    where: { email: { equals: result.email, mode: "insensitive" } },
    select: { id: true, email: true, name: true, image: true, lockedAt: true, totpEnabled: true },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: result.email,
        name: result.email.split("@")[0],
        authMethod: "MAGIC_LINK",
      },
      select: { id: true, email: true, name: true, image: true, lockedAt: true, totpEnabled: true },
    });
    infoLog(
      "magic-link-provider",
      `provisioned new user via magic link: ${user.email}`,
    );
    writeAuditLog({
      organizationId: result.organizationId,
      userId: user.id,
      action: "auth.user_provisioned",
      entityType: "Auth",
      entityId: "magic-link",
      userEmail: user.email,
      userName: user.name,
    }).catch(() => undefined);
  }

  if (user.lockedAt) {
    warnLog(
      "magic-link-provider",
      `magic link verified but user ${user.id} is locked; denying`,
    );
    return null;
  }

  // Codex P1 (PR #352): refuse magic-link sign-in for users with TOTP
  // enabled. The link is a single factor (proof of email control);
  // allowing it to bypass an explicitly-enabled second factor would
  // defeat the user's own security choice. Users who set up TOTP MUST
  // sign in via password + TOTP.
  if (user.totpEnabled) {
    warnLog(
      "magic-link-provider",
      `magic-link verified for user ${user.id} but TOTP is enabled; denying. Users with 2FA MUST sign in via password + TOTP.`,
    );
    writeAuditLog({
      organizationId: result.organizationId,
      userId: user.id,
      action: "auth.login_denied",
      entityType: "Auth",
      entityId: "magic-link",
      userEmail: user.email,
      userName: user.name,
      metadata: { reason: "totp_enabled_magic_link_disallowed" },
    }).catch(() => undefined);
    return null;
  }

  writeAuditLog({
    organizationId: result.organizationId,
    userId: user.id,
    action: "auth.login_succeeded",
    entityType: "Auth",
    entityId: "magic-link",
    userEmail: user.email,
    userName: user.name,
  }).catch(() => undefined);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
  };
}

/**
 * NextAuth-bound wrapper. Extracts the request host server-side and
 * forwards it as the expected-org override so the pure helper does NOT
 * have to call `next/headers()` (which only resolves inside a server
 * component / route handler with bound request context).
 */
async function authorizeMagicLinkFromRequest(
  credentials: Partial<Record<"token", unknown>>,
  request: Request,
) {
  const url = new URL(request.url);
  const trustForwarded = process.env.VF_TRUST_FORWARDED_HOST === "true";
  const host =
    (trustForwarded ? request.headers.get("x-forwarded-host") : null) ??
    request.headers.get("host") ??
    url.host;
  const expectedOrganizationId = await resolveOrgIdFromHost(host);
  return authorizeMagicLink(
    credentials as Record<string, unknown> | undefined,
    expectedOrganizationId,
  );
}

export const magicLinkProvider = Credentials({
  id: "magic-link",
  name: "Magic Link",
  credentials: {
    token: { label: "Token", type: "text" },
  },
  authorize: authorizeMagicLinkFromRequest,
});
