/**
 * Magic-link NextAuth provider (plan §8 / §16b OSS-9).
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
 * for Cloud (plan §12 step 1). The provider creates a User row with
 * `authMethod = "MAGIC_LINK"` if no user exists for the verified
 * email. OrgMember linkage is the caller's responsibility — the
 * Cloud signup route (S16b cloud-3) handles the first-user-as-OWNER
 * bootstrap.
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

/**
 * Pure authorize function, exported so unit tests can exercise it
 * without going through next-auth's wrapping.
 */
export async function authorizeMagicLink(
  credentials: Record<string, unknown> | undefined,
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

  // Codex P1 (PR #352): `expectedOrganizationId` is REQUIRED here. If
  // credentials don't carry organizationId, `consumeMagicLink` would
  // skip the tenant check, letting a token captured from org A be
  // redeemed on org B. Refuse the redeem outright when missing.
  if (
    typeof credentials.organizationId !== "string" ||
    credentials.organizationId.length === 0
  ) {
    warnLog(
      "magic-link-provider",
      "magic-link credentials missing organizationId; refusing redeem",
    );
    return null;
  }
  const expectedOrganizationId = credentials.organizationId;

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
  let user = await prisma.user.findUnique({
    where: { email: result.email },
    select: { id: true, email: true, name: true, image: true, lockedAt: true },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: result.email,
        name: result.email.split("@")[0],
        authMethod: "MAGIC_LINK",
      },
      select: { id: true, email: true, name: true, image: true, lockedAt: true },
    });
    infoLog(
      "magic-link-provider",
      `provisioned new user via magic link: ${user.email}`,
    );
    writeAuditLog({
      userId: user.id,
      action: "auth.user_provisioned",
      entityType: "Auth",
      entityId: "magic-link",
      userEmail: user.email,
      userName: user.name,
      metadata: { organizationId: result.organizationId },
    }).catch(() => undefined);
  }

  if (user.lockedAt) {
    warnLog(
      "magic-link-provider",
      `magic link verified but user ${user.id} is locked; denying`,
    );
    return null;
  }

  writeAuditLog({
    userId: user.id,
    action: "auth.login_succeeded",
    entityType: "Auth",
    entityId: "magic-link",
    userEmail: user.email,
    userName: user.name,
    metadata: { organizationId: result.organizationId },
  }).catch(() => undefined);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
  };
}

export const magicLinkProvider = Credentials({
  id: "magic-link",
  name: "Magic Link",
  credentials: {
    token: { label: "Token", type: "text" },
    organizationId: { label: "Organization", type: "text" },
  },
  authorize: authorizeMagicLink,
});
