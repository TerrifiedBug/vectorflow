/**
 * WebAuthn challenge issuance endpoint (plan §8 / §16b OSS-8).
 *
 * Browser calls this BEFORE `navigator.credentials.get()` to obtain the
 * `PublicKeyCredentialRequestOptionsJSON` it needs to invoke the
 * authenticator. The server persists the challenge so
 * `finishAuthentication` can match it later (the assertion submitted
 * back through NextAuth's signIn flow includes the challenge bytes).
 *
 * Request body (optional):
 *   { email?: string }   — when supplied, the server pre-resolves the
 *                          user and pins `allowCredentials` to that
 *                          user's stored passkeys. When absent, the
 *                          server emits a "usernameless" options blob
 *                          and the browser picks a credential via
 *                          conditional-mediation UI.
 *
 * No auth required; this is the pre-auth step.
 *
 * Rate limit: per-IP, courtesy of `org-rate-limit.ts`'s default for
 * unauthenticated endpoints.
 */

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { startAuthentication } from "@/server/services/webauthn";
import { warnLog } from "@/lib/logger";

const RP_ID = process.env.VF_WEBAUTHN_RP_ID ?? "localhost";
const RP_NAME = process.env.VF_WEBAUTHN_RP_NAME ?? "VectorFlow";

interface RequestBody {
  email?: string;
}

export async function POST(req: NextRequest) {
  let body: RequestBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // The endpoint accepts an optional email; missing means
  // "usernameless" — the browser picks a credential via the platform's
  // conditional-mediation UI.
  let userId: string | undefined;
  if (typeof body.email === "string" && body.email.length > 0) {
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true },
    });
    if (user) {
      userId = user.id;
    }
    // If the email is unknown we deliberately do NOT 404 — that would
    // leak user-existence. We still emit a usernameless options blob;
    // the assertion will fail later if the email was wrong, with the
    // same shape as a wrong-password failure.
  }

  try {
    const options = await startAuthentication({
      rp: {
        rpName: RP_NAME,
        rpID: RP_ID,
        expectedOrigin: req.headers.get("origin") ?? "",
      },
      userId,
    });
    return NextResponse.json(options);
  } catch (err) {
    warnLog("webauthn-options", "startAuthentication failed", err);
    return NextResponse.json(
      { error: "Unable to issue WebAuthn challenge" },
      { status: 500 },
    );
  }
}
