import crypto from "crypto";
import { NextRequest } from "next/server";
import { getOrgSettings } from "@/lib/org-settings";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";
import { decrypt } from "@/server/services/crypto";

/**
 * Authenticate a SCIM request using the bearer token.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function authenticateScim(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  const token = auth.slice(7);
  const settings = await getOrgSettings(DEFAULT_ORG_ID);
  if (!settings?.scimEnabled || !settings?.scimBearerToken) return false;

  try {
    const storedToken = decrypt(settings.scimBearerToken);
    const a = Buffer.from(token);
    const b = Buffer.from(storedToken);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
