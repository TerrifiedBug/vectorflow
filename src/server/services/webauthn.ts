/**
 * WebAuthn / passkey service layer.
 *
 * Wraps `@simplewebauthn/server` with persistent challenge storage and
 * credential bookkeeping. The four public functions are the OSS-shippable
 * primitives that an HTTP route or NextAuth Credentials provider builds on
 * top of:
 *
 *   1. `startRegistration` — mints PublicKeyCredentialCreationOptionsJSON
 *      for the browser and persists the challenge.
 *   2. `finishRegistration` — verifies the attestation response,
 *      atomically consumes the challenge, and stores the credential
 *      (id, public key, counter, transports, deviceType, backedUp).
 *   3. `startAuthentication` — mints PublicKeyCredentialRequestOptionsJSON,
 *      optionally pinned to a known user so `allowCredentials` is populated.
 *   4. `finishAuthentication` — verifies the assertion against the stored
 *      credential, bumps the signature counter, and returns the userId.
 *
 * Passkeys are User-scoped: a user with memberships in multiple orgs uses
 * the same credential set across them. The relying-party id (`rpID`) is
 * the platform apex (`vectorflow.sh`); per-org JWT signing keys still
 * scope the resulting session to one tenant.
 *
 * Replay defence:
 *   - Challenges are single-use: `finishRegistration` /
 *     `finishAuthentication` delete the row inside the same transaction
 *     they read it from, so a leaked challenge cannot be re-submitted.
 *   - Counter monotonicity: `finishAuthentication` rejects assertions
 *     whose `newCounter <= storedCounter`. The default counter starts at
 *     0; some authenticators always report 0, in which case the equality
 *     check is satisfied by `> 0` (RFC 8809 §6.1.1).
 *
 * The HTTP routes that drive this surface (and the NextAuth Credentials
 * provider that consumes a successful assertion) are deliberately not in
 * this file. The service is reusable from a custom HTTP route, an
 * authn-only RPC handler, or a third-party identity stack — keep the
 * coupling minimal.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";

import { prisma } from "@/lib/prisma";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface WebAuthnRpConfig {
  /** Display name shown by the authenticator UI. */
  rpName: string;
  /** Relying-Party identifier — the registrable domain, e.g. `vectorflow.sh`. */
  rpID: string;
  /** Origin(s) accepted at verification time, e.g. `https://acme.vectorflow.sh`. */
  expectedOrigin: string | string[];
}

export interface StoredCredential {
  id: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: bigint;
  transports: string[];
  deviceType: string | null;
  backedUp: boolean;
}

/**
 * Begin a WebAuthn registration ceremony for `userId`. Returns the
 * `navigator.credentials.create(...)` options the browser needs. The
 * challenge is persisted in `WebAuthnChallenge` with a 5-minute TTL.
 */
export async function startRegistration(opts: {
  rp: WebAuthnRpConfig;
  userId: string;
  userName: string;
  userDisplayName?: string;
  /** Tenant scope persisted on the challenge row. */
  organizationId?: string;
  /**
   * Existing credentials for the user; passed as `excludeCredentials` so
   * the authenticator refuses to register the same passkey twice.
   */
  existingCredentials?: Array<{
    credentialId: string;
    transports: string[];
  }>;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const options = await generateRegistrationOptions({
    rpName: opts.rp.rpName,
    rpID: opts.rp.rpID,
    userName: opts.userName,
    userDisplayName: opts.userDisplayName,
    // userID accepts a Uint8Array; encode the cuid as UTF-8 bytes.
    userID: new TextEncoder().encode(opts.userId),
    attestationType: "none", // passkey UX — we don't need attestation
    excludeCredentials: (opts.existingCredentials ?? []).map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      userVerification: "preferred",
      residentKey: "required",
      requireResidentKey: true,
    },
  });

  await prisma.webAuthnChallenge.create({
    data: {
      kind: "register",
      challenge: options.challenge,
      userId: opts.userId,
      organizationId: opts.organizationId ?? "default",
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  return options;
}

export interface FinishRegistrationResult {
  credentialId: string;
}

/**
 * Verify the attestation response. On success, persists a row in
 * `WebAuthnCredential` and consumes the challenge atomically. Throws
 * when the challenge is unknown / expired or the attestation fails.
 */
export async function finishRegistration(opts: {
  rp: WebAuthnRpConfig;
  userId: string;
  response: RegistrationResponseJSON;
  /** Optional friendly label, e.g. "YubiKey 5C". */
  name?: string;
  /** Override of `Date.now()` — for tests only. */
  now?: () => Date;
}): Promise<FinishRegistrationResult> {
  const now = opts.now ?? (() => new Date());

  // Capture the challenge in a closure that survives outside the
  // transaction. If the transaction throws (verifier failure, unverified
  // assertion, race-loser delete), the tx is rolled back \u2014 INCLUDING
  // any `tx.webAuthnChallenge.deleteMany` we did inside the catch \u2014
  // and the challenge stays alive, breaking single-use on every failure
  // path. Codex P1 round-7 review of PR #332 flagged this. The fix is
  // to do the failure-path consume OUTSIDE the transaction using the
  // global `prisma` client, so the deletion is durable regardless of
  // tx rollback.
  let consumedChallenge: string | null = null;

  try {
    return await prisma.$transaction(async (tx) => {
      const verification = await verifyRegistrationResponse({
        response: opts.response,
        expectedOrigin: opts.rp.expectedOrigin,
        expectedRPID: opts.rp.rpID,
        requireUserVerification: false,
        expectedChallenge: async (challenge) => {
          const row = await tx.webAuthnChallenge.findUnique({
            where: { challenge },
          });
          if (!row) return false;
          if (row.kind !== "register") return false;
          if (row.userId !== opts.userId) return false;
          if (row.expiresAt.getTime() < now().getTime()) return false;
          consumedChallenge = challenge;
          return true;
        },
      });

      if (!verification.verified || !verification.registrationInfo) {
        throw new Error("WebAuthn registration verification failed");
      }

      // Race-safe single-use consume on the happy path. `deleteMany` MUST
      // affect exactly one row \u2014 a concurrent registration with the same
      // challenge that beat us to the delete leaves us with count=0 and
      // we throw + roll back the credential insert.
      if (consumedChallenge === null) {
        throw new Error(
          "WebAuthn registration verification failed: challenge not captured",
        );
      }
      const { count: consumedRows } = await tx.webAuthnChallenge.deleteMany({
        where: { challenge: consumedChallenge },
      });
      if (consumedRows !== 1) {
        throw new Error(
          "WebAuthn registration verification failed: challenge already consumed (replay)",
        );
      }

      const reg = verification.registrationInfo;
      const cred = await tx.webAuthnCredential.create({
        data: {
          userId: opts.userId,
          credentialId: reg.credential.id,
          // Prisma `Bytes` column accepts Buffer / Uint8Array; coerce to
          // Buffer for the broadest pg driver compatibility.
          publicKey: Buffer.from(reg.credential.publicKey),
          counter: BigInt(reg.credential.counter ?? 0),
          transports: (reg.credential.transports ?? []) as string[],
          deviceType: reg.credentialDeviceType ?? null,
          backedUp: reg.credentialBackedUp ?? false,
          name: opts.name ?? null,
        },
      });

      return { credentialId: cred.credentialId };
    });
  } catch (err) {
    // Failure path: the tx rolled back, but we still want the challenge
    // consumed so it can't be replayed with a different payload. Use the
    // GLOBAL prisma client \u2014 the tx is gone.
    if (consumedChallenge !== null) {
      await prisma.webAuthnChallenge.deleteMany({
        where: { challenge: consumedChallenge },
      });
    }
    throw err;
  }
}

/**
 * Begin a WebAuthn authentication ceremony. When `userId` is supplied
 * we populate `allowCredentials` from the user's stored credentials,
 * which lets the authenticator pick the right key without prompting.
 * Passing no `userId` enables the usernameless flow.
 */
export async function startAuthentication(opts: {
  rp: WebAuthnRpConfig;
  userId?: string;
  /** Tenant scope persisted on the challenge row. */
  organizationId?: string;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const allowCredentials = opts.userId
    ? (
        await prisma.webAuthnCredential.findMany({
          where: { userId: opts.userId },
          select: { credentialId: true, transports: true },
        })
      ).map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransportFuture[],
      }))
    : [];

  const options = await generateAuthenticationOptions({
    rpID: opts.rp.rpID,
    allowCredentials,
    userVerification: "preferred",
  });

  await prisma.webAuthnChallenge.create({
    data: {
      kind: "authenticate",
      challenge: options.challenge,
      userId: opts.userId ?? null,
      organizationId: opts.organizationId ?? "default",
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  return options;
}

export interface FinishAuthenticationResult {
  userId: string;
  credentialId: string;
}

/**
 * Verify the assertion and return the authenticated `userId`. Bumps the
 * stored signature counter and consumes the challenge in the same
 * transaction. Throws on replay (counter not strictly higher than stored)
 * and on stale / wrong-kind challenges.
 */
export async function finishAuthentication(opts: {
  rp: WebAuthnRpConfig;
  response: AuthenticationResponseJSON;
  /** Override of `Date.now()` — for tests only. */
  now?: () => Date;
}): Promise<FinishAuthenticationResult> {
  const now = opts.now ?? (() => new Date());
  const credentialIdFromResponse = opts.response.id;

  // Same hoisted-cleanup pattern as `finishRegistration` \u2014 see the
  // comment there. Codex P1 round-7 on PR #332: the failure-path delete
  // MUST run outside the transaction or a tx rollback wipes it out and
  // the challenge stays alive.
  let consumedChallenge: string | null = null;

  try {
    return await prisma.$transaction(async (tx) => {
      const stored = await tx.webAuthnCredential.findUnique({
        where: { credentialId: credentialIdFromResponse },
      });
      if (!stored) {
        throw new Error("WebAuthn credential not registered");
      }

      const verification = await verifyAuthenticationResponse({
        response: opts.response,
        expectedOrigin: opts.rp.expectedOrigin,
        expectedRPID: opts.rp.rpID,
        requireUserVerification: false,
        credential: {
          id: stored.credentialId,
          publicKey: new Uint8Array(stored.publicKey),
          counter: Number(stored.counter),
          transports: stored.transports as AuthenticatorTransportFuture[],
        },
        expectedChallenge: async (challenge) => {
          const row = await tx.webAuthnChallenge.findUnique({
            where: { challenge },
          });
          if (!row) return false;
          if (row.kind !== "authenticate") return false;
          // Usernameless flow: row.userId may be null.
          if (row.userId && row.userId !== stored.userId) return false;
          if (row.expiresAt.getTime() < now().getTime()) return false;
          consumedChallenge = challenge;
          return true;
        },
      });

      if (!verification.verified) {
        throw new Error("WebAuthn authentication verification failed");
      }

      // Counter monotonicity. Platform-authenticator carve-out only
      // applies when BOTH sides are 0 (RFC 8809 \u00a76.1.1); any other path
      // through `newCounter <= stored.counter` is a cloned-authenticator
      // signal.
      const newCounter = BigInt(verification.authenticationInfo.newCounter);
      const isPlatformZero =
        newCounter === BigInt(0) && stored.counter === BigInt(0);
      if (!isPlatformZero && newCounter <= stored.counter) {
        throw new Error("WebAuthn counter regression — possible cloned authenticator");
      }

      // Race-safe conditional counter bump: matches only if no concurrent
      // assertion has already changed the stored counter.
      const { count: counterUpdated } = await tx.webAuthnCredential.updateMany({
        where: { id: stored.id, counter: stored.counter },
        data: {
          counter: newCounter,
          lastUsedAt: now(),
        },
      });
      if (counterUpdated !== 1) {
        throw new Error(
          "WebAuthn authentication verification failed: counter changed mid-flight (concurrent assertion race)",
        );
      }

      // Race-safe single-use consume on the happy path. The loser of a
      // concurrent assertion race lands on count=0 here and throws +
      // rolls back the counter update.
      if (consumedChallenge === null) {
        throw new Error(
          "WebAuthn authentication verification failed: challenge not captured",
        );
      }
      const { count: consumedRows } = await tx.webAuthnChallenge.deleteMany({
        where: { challenge: consumedChallenge },
      });
      if (consumedRows !== 1) {
        throw new Error(
          "WebAuthn authentication verification failed: challenge already consumed (replay)",
        );
      }

      return {
        userId: stored.userId,
        credentialId: stored.credentialId,
      };
    });
  } catch (err) {
    // Failure path: tx rolled back, but we still want the challenge
    // consumed so the same row can't be re-submitted with a different
    // payload. Global `prisma` client \u2014 outside the rolled-back tx.
    if (consumedChallenge !== null) {
      await prisma.webAuthnChallenge.deleteMany({
        where: { challenge: consumedChallenge },
      });
    }
    throw err;
  }
}

/**
 * Periodic sweep — call from a cron task to delete expired
 * `WebAuthnChallenge` rows. Challenges have a 5-minute TTL but the rows
 * are still useful as a denial-of-service mitigation (a flood of
 * `startAuthentication` requests creates rows we should clean up).
 */
export async function gcExpiredChallenges(now: () => Date = () => new Date()): Promise<number> {
  const { count } = await prisma.webAuthnChallenge.deleteMany({
    where: { expiresAt: { lt: now() } },
  });
  return count;
}
