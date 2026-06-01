import crypto from "crypto";
import { NextRequest } from "next/server";
import { adminPrisma } from "@/lib/prisma";
import { decrypt } from "@/server/services/crypto";
import { resolveOrgIdFromHost } from "@/lib/host-to-org";

/**
 * Authenticate a SCIM request using the bearer token and return the
 * organisation that token is valid for, or `null` on failure.
 *
 * The previous implementation hard-coded `DEFAULT_ORG_ID`, which made SCIM
 * single-tenant. In a multi-tenant deployment that either silently
 * broke SCIM (no DEFAULT_ORG_ID row in prod) or — worse — let any token
 * with that DSN write into the default org regardless of the request
 * host. Now:
 *
 *   1. Resolve the requesting organisation from the `Host:` header
 *      (the per-tenant subdomain pattern `<orgSlug>.vectorflow.sh`).
 *      `resolveOrgIdFromHost` falls back to `DEFAULT_ORG_ID` for OSS
 *      single-tenant deployments so OSS behaviour is preserved.
 *   2. Load the bearer token from THAT organisation's settings.
 *   3. Compare in constant time.
 *
 * Cross-tenant probing is now impossible: a token configured for org A
 * cannot satisfy a request on org B's host because the lookup happens
 * against org B's settings.
 */
export async function authenticateScim(
  req: NextRequest,
): Promise<{ ok: true; organizationId: string } | { ok: false }> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false };
  const token = auth.slice(7);

  const host =
    (process.env.VF_TRUST_FORWARDED_HOST === "true"
      ? req.headers.get("x-forwarded-host")
      : null) ?? req.headers.get("host") ?? "";
  const organizationId = await resolveOrgIdFromHost(host);

  // The bearer-token credential lookup runs before any tenancy scope is
  // established, so it reads the (fenced) OrganizationSettings via the admin
  // connection — the scoped client would see zero rows here under the fenced
  // role and break SCIM auth.
  const settings = await adminPrisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { scimEnabled: true, scimBearerToken: true },
  });
  if (!settings?.scimEnabled || !settings?.scimBearerToken) {
    return { ok: false };
  }

  try {
    const storedToken = decrypt(settings.scimBearerToken);
    const a = Buffer.from(token);
    const b = Buffer.from(storedToken);
    if (a.length !== b.length) return { ok: false };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false };
    return { ok: true, organizationId };
  } catch {
    return { ok: false };
  }
}
