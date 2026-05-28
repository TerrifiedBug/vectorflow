import NextAuth, { CredentialsSignin } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { encrypt, decrypt, ENCRYPTION_DOMAINS } from "@/server/services/crypto";
import {
  decryptForOrgOrFallback,
  loadOrgDataKeyCiphertext,
} from "@/server/services/crypto-v3-callsite";
import { verifyTotpCode, verifyBackupCode } from "@/server/services/totp";
import { authConfig } from "@/auth.config";
import { writeAuditLog } from "@/server/services/audit";
import { debugLog, infoLog, warnLog } from "@/lib/logger";
import { headers } from "next/headers";
import { env, isBuildPhase } from "@/lib/env";
import { isDemoMode } from "@/lib/is-demo-mode";
import {
  getDevAuthBypassSession,
  isDevAuthBypassEnabled,
  isDevAuthBypassRequestAllowed,
  logDevAuthBypassWarning,
} from "@/lib/dev-auth-bypass";
import {
  loginAttemptTracker,
  getRemainingLockSeconds,
  ACCOUNT_LOCKOUT_THRESHOLD,
  TOTP_RATE_LIMIT,
} from "@/server/services/login-protection";
import { getOrgSettings } from "@/lib/org-settings";
import { resolveOrgIdFromHost } from "@/lib/host-to-org";
import { getRequestHostFromHeaders } from "@/lib/request-host";
import { webauthnProvider } from "@/server/services/auth/webauthn-provider";
import { getJwtSecretForOrg } from "@/server/services/auth/jwt-key";

async function getClientIp(): Promise<string | null> {
  try {
    const hdrs = await headers();
    return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the request host used for per-org auth routing.
 *
 * Implementation lives in `@/lib/request-host`; this wrapper bridges
 * the `headers()` async API (Server Components / auth callbacks) to
 * the shared header-based helper so middleware, route handlers, and
 * auth callbacks agree on the same host string.
 */
async function getRequestHost(): Promise<string | null> {
  try {
    const hdrs = await headers();
    return getRequestHostFromHeaders(hdrs);
  } catch {
    return null;
  }
}

class TotpRequiredError extends CredentialsSignin {
  code = "TOTP_REQUIRED";
}

class InvalidVerificationCodeError extends CredentialsSignin {
  code = "INVALID_TOTP";
}

/**
 * Load OIDC settings for the organisation owning the incoming request.
 *
 * Per-org OIDC:
 *   - The request host's first DNS label is matched against
 *     `Organization.slug`. Each tenant sees only its own IdP; a session
 *     minted for org A cannot login through org B.
 *   - Hosts without an org-slug subdomain fall back to
 *     `DEFAULT_ORG_ID` so existing self-hosted deployments behave exactly
 *     as before.
 * Returns null when:
 *   - we're in the Next.js build phase (no DB), OR
 *   - the resolved org has no OIDC configured, OR
 *   - the stored client secret cannot be decrypted (key rotation gap).
 */
async function getOidcSettings(orgIdOverride?: string) {
  // Skip DB query during build (no database available)
  if (isBuildPhase) return null;

  try {
    const orgId =
      orgIdOverride ?? (await resolveOrgIdFromHost(await getRequestHost()));
    const settings = await getOrgSettings(orgId);
    if (settings?.oidcIssuer && settings?.oidcClientId && settings?.oidcClientSecret) {
      let clientSecret: string;
      try {
        const dataKeyCiphertext = await loadOrgDataKeyCiphertext(prisma, orgId);
        clientSecret = await decryptForOrgOrFallback(settings.oidcClientSecret, {
          orgId,
          dataKeyCiphertext,
          domain: ENCRYPTION_DOMAINS.GENERIC,
          rowTable: "OrganizationSettings",
          rowId: settings.id,
        });
      } catch {
        return null;
      }
      return {
        issuer: settings.oidcIssuer,
        clientId: settings.oidcClientId,
        clientSecret,
        displayName: settings.oidcDisplayName ?? "SSO",
        tokenEndpointAuthMethod: settings.oidcTokenEndpointAuthMethod ?? "client_secret_post",
        groupSyncEnabled: settings.oidcGroupSyncEnabled,
        groupsScope: settings.oidcGroupsScope,
        groupsClaim: settings.oidcGroupsClaim ?? "groups",
        organizationId: orgId,
      };
    }
  } catch {
    // Database may not be available yet (e.g., during build)
  }
  return null;
}

const credentialsProvider = Credentials({
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
    totpCode: { label: "2FA Code", type: "text" },
  },
  async authorize(credentials) {
    if (env.VF_DISABLE_LOCAL_AUTH === "true") {
      throw new Error("Local authentication is disabled");
    }

    if (!credentials?.email || !credentials?.password) return null;

    const ipAddress = await getClientIp();
    const email = credentials.email as string;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user?.passwordHash) {
      writeAuditLog({
        userId: null, action: "auth.login_failed", entityType: "Auth", entityId: "credentials",
        ipAddress, userEmail: email, userName: null, metadata: { reason: "unknown_email" },
      }).catch(() => {});
      return null;
    }

    // Check account lockout. Brute-force locks auto-expire after 15 minutes;
    // admin-imposed locks never expire automatically.
    if (user.lockedAt) {
      const remainingSecs = getRemainingLockSeconds(user.lockedAt, user.lockedBy);
      if (remainingSecs > 0) {
        writeAuditLog({
          userId: user.id, action: "auth.login_failed", entityType: "Auth", entityId: "credentials",
          ipAddress, userEmail: user.email, userName: user.name,
          metadata: {
            reason: "account_locked",
            remainingSeconds: Number.isFinite(remainingSecs) ? remainingSecs : null,
            isPermanentLock: !Number.isFinite(remainingSecs),
          },
        }).catch(() => {});
        return null;
      }
      // Lock has expired — clear it so this attempt can proceed
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedAt: null, lockedBy: null },
      });
      loginAttemptTracker.clearFailures(email);
    }

    const valid = await bcrypt.compare(
      credentials.password as string,
      user.passwordHash
    );
    if (!valid) {
      const failures = loginAttemptTracker.recordFailure(email);
      const shouldLock = failures >= ACCOUNT_LOCKOUT_THRESHOLD;

      if (shouldLock) {
        await prisma.user.update({
          where: { id: user.id },
          data: { lockedAt: new Date(), lockedBy: "brute_force" },
        });
        writeAuditLog({
          userId: user.id, action: "auth.account_locked", entityType: "Auth", entityId: "credentials",
          ipAddress, userEmail: user.email, userName: user.name,
          metadata: { reason: "brute_force", failedAttempts: failures },
        }).catch(() => {});
      } else {
        writeAuditLog({
          userId: user.id, action: "auth.login_failed", entityType: "Auth", entityId: "credentials",
          ipAddress, userEmail: user.email, userName: user.name,
          metadata: { reason: "invalid_password", failedAttempts: failures, lockoutAt: ACCOUNT_LOCKOUT_THRESHOLD },
        }).catch(() => {});
      }
      return null;
    }

    // TOTP 2FA check (bypassed in hosted demo mode so visitors can sign in
    // with the seeded shared account regardless of its TOTP state).
    if (!isDemoMode() && user.totpEnabled && user.totpSecret) {
      const raw = credentials.totpCode as string | undefined;
      const totpCode = raw && raw !== "undefined" ? raw.trim() : undefined;

      if (!totpCode) {
        throw new TotpRequiredError();
      }

      const secret = decrypt(user.totpSecret);
      let codeValid = verifyTotpCode(secret, totpCode);

      // If TOTP code didn't match, try as a backup code
      if (!codeValid && user.totpBackupCodes) {
        const hashedCodes: string[] = JSON.parse(decrypt(user.totpBackupCodes));
        const result = verifyBackupCode(totpCode, hashedCodes);
        if (result.valid) {
          codeValid = true;
          // Consume the backup code
          await prisma.user.update({
            where: { id: user.id },
            data: { totpBackupCodes: encrypt(JSON.stringify(result.remaining)) },
          });
        }
      }

      if (!codeValid) {
        // Count invalid TOTP toward both the overall lockout threshold and the
        // TOTP-specific rate limit. Use separate counters so the TOTP limit
        // (TOTP_RATE_LIMIT) is only triggered by actual TOTP failures, never
        // by a mix of password + TOTP failures sharing one counter.
        const allFailures = loginAttemptTracker.recordFailure(email);
        const totpFailures = loginAttemptTracker.recordTotpFailure(email);
        const shouldLock = totpFailures >= TOTP_RATE_LIMIT || allFailures >= ACCOUNT_LOCKOUT_THRESHOLD;

        if (shouldLock) {
          await prisma.user.update({
            where: { id: user.id },
            data: { lockedAt: new Date(), lockedBy: "brute_force" },
          });
          writeAuditLog({
            userId: user.id, action: "auth.account_locked", entityType: "Auth", entityId: "credentials",
            ipAddress, userEmail: user.email, userName: user.name,
            metadata: { reason: "totp_brute_force", failedAttempts: allFailures, totpFailedAttempts: totpFailures },
          }).catch(() => {});
        } else {
          writeAuditLog({
            userId: user.id, action: "auth.login_failed", entityType: "Auth", entityId: "credentials",
            ipAddress, userEmail: user.email, userName: user.name,
            metadata: { reason: "invalid_totp", failedAttempts: allFailures, lockoutAt: ACCOUNT_LOCKOUT_THRESHOLD },
          }).catch(() => {});
        }
        throw new InvalidVerificationCodeError();
      }
    }

    // Successful login — clear all in-memory failure counters
    loginAttemptTracker.clearFailures(email);
    loginAttemptTracker.clearTotpFailures(email);

    writeAuditLog({
      userId: user.id, action: "auth.login_success", entityType: "Auth", entityId: "credentials",
      ipAddress, userEmail: user.email, userName: user.name,
    }).catch(() => {});

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    };
  },
});

/**
/**
 * Per-organisation NextAuth instance cache.
 *
 * The NextAuth `providers` array bakes in the OIDC issuer at construction
 * time \u2014 we can't swap providers per-request inside one instance. So we
 * keep one instance per organisation id and pick the right one on every
 * call. First-time init for an org goes through the de-dupe promise map
 * so concurrent requests don't double-initialise.
 *
 * Codex P1 on the initial PR called this out: caching a single global
 * `_cached` instance meant the first request's host\u2014and therefore the
 * first request's tenant\u2014decided the OIDC provider for ALL subsequent
 * requests until cache invalidation. Tenant B could be forced onto
 * tenant A's IdP depending on request order.
 *
 * `invalidateAuthCache(orgId?)` clears one org's cache when its OIDC
 * settings change, or all caches when called with no argument.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthInstance = { handlers: any; auth: any; signIn: any; signOut: any };
const _instanceByOrg = new Map<string, AuthInstance>();
const _initPromiseByOrg = new Map<string, Promise<AuthInstance>>();

async function getAuthInstance() {
  // Resolve the org from the request host BEFORE consulting the cache so
  // Tenant B never reuses Tenant A's NextAuth instance.
  const orgId = await resolveOrgIdFromHost(await getRequestHost());
  const cached = _instanceByOrg.get(orgId);
  if (cached) return cached;

  // Deduplicate concurrent inits for the same org.
  const inFlight = _initPromiseByOrg.get(orgId);
  if (!inFlight) {
    const promise = (async () => {
      const providers: Provider[] = [credentialsProvider, webauthnProvider];

      const oidc = await getOidcSettings(orgId);
      if (oidc) {
        providers.push({
          id: "oidc",
          name: oidc.displayName,
          type: "oidc",
          issuer: oidc.issuer,
          clientId: oidc.clientId,
          clientSecret: oidc.clientSecret,
          allowDangerousEmailAccountLinking: true,
          ...(oidc.groupSyncEnabled && oidc.groupsScope && { authorization: { params: { scope: `openid profile email ${oidc.groupsScope}` } } }),
          client: {
            token_endpoint_auth_method: oidc.tokenEndpointAuthMethod,
          },
        } as Provider);
        infoLog("auth", `OIDC provider registered: ${oidc.displayName} (${oidc.issuer})`);
      }

      // Per-org JWT signing secret derived from the org's DEK via
      // Per-org JWT signing secret derived from the org's DEK via
      // `deriveJwtSigningKey` — see jwt-key.ts.
      // Falls back to NEXTAUTH_SECRET when the org has no DEK (OSS /
      // self-hosted path). When fromEnv=true we pass the raw env string
      // directly so existing sessions signed with the raw secret remain
      // valid; base64url-encoding would produce a different key and
      // immediately invalidate all existing tokens on upgrade.
      const jwtKeyResult = await getJwtSecretForOrg(orgId);
      // Env-fallback: use the raw NEXTAUTH_SECRET string so Auth.js
      // uses the same key it would have used before per-org derivation.
      // DEK-derived: base64url-encode the Buffer; also include the legacy
      // NEXTAUTH_SECRET as a second entry so pre-existing JWTs that were
      // signed with the env secret before DEK rollout remain verifiable.
      // Auth.js verifies against all entries in the array; signing always
      // uses the first entry (the DEK-derived key).
      //
      // The legacy secret is ONLY included when rotationCounter === 0
      // (the org has never explicitly revoked sessions). Once the operator
      // calls revokeOrgSessions (counter > 0), all pre-DEK tokens have
      // been explicitly invalidated; including the legacy secret after that
      // would allow those old tokens to bypass the revocation.
      const includesLegacySecret =
        !jwtKeyResult.fromEnv &&
        jwtKeyResult.rotationCounter === 0 &&
        !!process.env.NEXTAUTH_SECRET;
      const secretArg = jwtKeyResult.fromEnv
        ? [process.env.NEXTAUTH_SECRET!]
        : [
            jwtKeyResult.value.toString("base64url"),
            ...(includesLegacySecret ? [process.env.NEXTAUTH_SECRET!] : []),
          ];

      const instance = NextAuth({
        ...authConfig,
        adapter: PrismaAdapter(prisma),
        providers,
        secret: secretArg,
        callbacks: {
          ...authConfig.callbacks,
          async signIn({ user, account, profile }) {
            // For OIDC sign-ins, auto-create user and team membership with role mapping
            if (account?.provider === "oidc" && user.email) {
              const oidcOrgId = await resolveOrgIdFromHost(await getRequestHost());
              const settings = await getOrgSettings(oidcOrgId);
              const profileData = profile as Record<string, unknown> | undefined;

              // Ensure user exists in the database
              let dbUser = await prisma.user.findUnique({
                where: { email: user.email },
              });
              if (!dbUser) {
                dbUser = await prisma.user.create({
                  data: {
                    email: user.email,
                    name: user.name ?? profile?.name ?? user.email.split("@")[0],
                    image: (profileData?.picture as string) ?? null,
                    authMethod: "OIDC",
                  },
                });
                const ipAddress = await getClientIp();
                writeAuditLog({
                  userId: dbUser.id, action: "auth.user_provisioned", entityType: "Auth", entityId: "oidc",
                  ipAddress, userEmail: dbUser.email, userName: dbUser.name,
                }).catch(() => {});
              } else if (dbUser.authMethod && dbUser.authMethod !== "OIDC") {
                // Block OIDC login for existing non-OIDC accounts — an
                // admin MUST explicitly link the account through the
                // settings surface, never via implicit email collision.
                // The old check only blocked authMethod === "LOCAL",
                // letting an attacker who controlled an OIDC issuer
                // silently fuse with an account whose primary
                // authMethod was WEBAUTHN or MAGIC_LINK.
                const ipAddress = await getClientIp();
                writeAuditLog({
                  userId: dbUser.id, action: "auth.oidc_link_blocked", entityType: "Auth", entityId: "oidc",
                  ipAddress, userEmail: dbUser.email, userName: dbUser.name,
                  metadata: { reason: "non_oidc_account_exists", existingAuthMethod: dbUser.authMethod },
                }).catch(() => {});
                warnLog("auth", `OIDC login blocked: existing account uses ${dbUser.authMethod} for ${dbUser.email}. Admin must explicitly link accounts.`);
                return "/login?error=local_account";
              }

              // Refresh profile picture on each OIDC sign-in
              const profilePicture = (profileData?.picture as string) ?? null;
              if (profilePicture && dbUser.image !== profilePicture) {
                await prisma.user.update({
                  where: { id: dbUser.id },
                  data: { image: profilePicture },
                });
              }

              // Group sync: reconcile team memberships from group claims
              if (settings?.oidcGroupSyncEnabled) {
                const groupsClaim = settings.oidcGroupsClaim ?? "groups";
                const tokenGroups = (profileData?.[groupsClaim] as string[] | undefined) ?? [];
                debugLog("oidc", `User ${user.email} groups (claim "${groupsClaim}"):`, tokenGroups);

                let userGroupNames: string[];

                if (settings.scimEnabled) {
                  // SCIM+OIDC mode: union of ScimGroupMember groups + token groups
                  // OIDC does NOT write to ScimGroupMember (avoids Azure AD 200-group token limit)
                  const scimGroups = await prisma.scimGroupMember.findMany({
                    where: { userId: dbUser.id },
                    include: { scimGroup: { select: { displayName: true } } },
                  });
                  const scimGroupNames = scimGroups.map((g) => g.scimGroup.displayName);
                  userGroupNames = [...new Set([...scimGroupNames, ...tokenGroups])];
                } else {
                  // OIDC-only mode: use token groups directly
                  userGroupNames = tokenGroups;
                }

                debugLog("oidc", `User ${user.email} scimEnabled=${settings.scimEnabled}, final groups:`, userGroupNames);
                const { reconcileUserTeamMemberships } = await import("@/server/services/group-mappings");
                await prisma.$transaction(async (tx) => {
                  await reconcileUserTeamMemberships(tx, dbUser.id, userGroupNames, oidcOrgId);
                });

                // Default team fallback: assign if reconciliation left the user with no memberships
                if (settings.oidcDefaultTeamId) {
                  const hasMembership = await prisma.teamMember.findFirst({
                    where: { userId: dbUser.id },
                  });
                  if (!hasMembership) {
                    const defaultRole = settings.oidcDefaultRole ?? "VIEWER";
                    await prisma.teamMember.upsert({
                      where: { userId_teamId: { userId: dbUser.id, teamId: settings.oidcDefaultTeamId } },
                      create: {
                        userId: dbUser.id,
                        teamId: settings.oidcDefaultTeamId,
                        role: defaultRole,
                        source: "group_mapping",
                      },
                      update: {},
                    });
                  }
                }
              }

              user.id = dbUser.id;

              const ipAddress = await getClientIp();
              writeAuditLog({
                userId: dbUser.id, action: "auth.login_success", entityType: "Auth", entityId: "oidc",
                ipAddress, userEmail: dbUser.email, userName: dbUser.name,
              }).catch(() => {});
            }
            return true;
          },
          async jwt({ token, user, account }) {
            if (user) {
              token.id = user.id;
            }
            if (account) {
              token.provider = account.provider;
            }
            // Cross-org token replay guard (H7). On any request that presents
            // an existing JWT (not a fresh sign-in), verify the org_id claim
            // matches the org derived from the request host. Per-org signing
            // keys are the primary defence for DEK-provisioned orgs; this is
            // the belt for env-fallback orgs that share NEXTAUTH_SECRET.
            // Strict from day one: tokens without an org_id claim (issued
            // before H7 was deployed) are also rejected — operators MUST run
            // bump-jwt-rotation-counter to force re-authentication on deploy.
            if (!user && !account) {
              const claimedOrgId = (token as { org_id?: unknown }).org_id;
              if (typeof claimedOrgId !== "string" || claimedOrgId !== orgId) {
                return {};
              }
            }
            // Stamp / refresh the org_id claim on the token.
            // On sign-in (user/account present) this sets the claim for the
            // first time. On refresh it re-affirms the current org — if the
            // org resolved from the host ever diverges from the stored claim
            // the guard above has already rejected the token before we reach
            // this line.
            token.org_id = orgId;
            // Server-side session invalidation for permanently-locked
            // accounts. `user.eraseSelf` sets `User.lockedAt` with
            // `lockedBy === "erasure"` after pseudonymising the row.
            // Without this check, the caller's already-issued JWT would
            // keep authenticating against `user.id` for the rest of the
            // session's natural lifetime — Codex P1 finding on the
            // org-domain-claim PR.
            //
            // Cached for 5s on the token itself so we don't hit the DB
            // on every authenticated request. reduced the
            // window from 60s; GDPR Art. 17 expectations are tighter
            // than a minute, and 5s is short enough that an admin who
            // just erased a user can refresh the dashboard and see the
            // session gone.
            // Other lockedBy values (e.g. "brute_force") are sign-in
            // gates only — they auto-clear on the next sign-in attempt
            // past the unlock window and we leave active sessions alone.
            if (token.id) {
              const lastCheckRaw = (token as { erasureCheckedAt?: unknown })
                .erasureCheckedAt;
              const lastCheck =
                typeof lastCheckRaw === "number" ? lastCheckRaw : 0;
              const nowMs = Date.now();
              if (nowMs - lastCheck > 5_000) {
                const u = await prisma.user.findUnique({
                  where: { id: token.id as string },
                  select: { lockedAt: true, lockedBy: true },
                });
                if (u?.lockedAt && u.lockedBy === "erasure") {
                  // Returning an empty token forces NextAuth to treat
                  // the request as unauthenticated. The client sees a
                  // null session and is redirected to sign-in.
                  return {};
                }
                (token as { erasureCheckedAt?: number }).erasureCheckedAt =
                  nowMs;
              }
            }
            return token;
          },
          async session({ session, token }) {
            if (session.user) {
              session.user.id = token.id as string;
              // Forward the org binding onto the session object so callers
              // (tRPC context, server components) can read it without
              // decoding the JWT themselves.
              session.user.org_id = token.org_id as string;
            }
            return session;
          },
        },
        events: {
          async signOut(message) {
            const ipAddress = await getClientIp();
            const token = "token" in message ? message.token : null;
            const userId = (token?.id as string) ?? null;
            if (userId) {
              const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { email: true, name: true },
              });
              writeAuditLog({
                userId, action: "auth.logout", entityType: "Auth", entityId: "session",
                ipAddress, userEmail: user?.email ?? null, userName: user?.name ?? null,
              }).catch(() => {});
            }
          },
        },
      });

      // Do NOT cache when KMS failed: the next request must retry KMS
      // so the instance is rebuilt with the correct per-org key once
      // the KMS recovers. Caching the env-fallback instance would pin
      // this org to the shared env secret until manual restart.
      if (!jwtKeyResult.kmsFailure) {
        _instanceByOrg.set(orgId, instance);
      }
      _initPromiseByOrg.delete(orgId);
      return instance;
    })();
    // Clear the in-flight promise entry whether init succeeds or fails so
    // a transient DB/KMS failure on bootstrap does not pin a rejected promise
    // in the map and cause every subsequent request for the org to keep failing
    // until manual cache invalidation or process restart.
    promise.catch(() => {
      _initPromiseByOrg.delete(orgId);
    });
    _initPromiseByOrg.set(orgId, promise);
    return promise;
  }
  return inFlight;
}

/**
 * Clear the cached NextAuth instance(s) so the next request re-initializes
 * with fresh OIDC settings. Pass an `orgId` to clear just one tenant's
 * cache (called from `settings.updateOidc*` mutations); call with no
 * argument from tests / dev tools to wipe everything.
 */
export function invalidateAuthCache(orgId?: string) {
  if (orgId) {
    _instanceByOrg.delete(orgId);
    _initPromiseByOrg.delete(orgId);
    return;
  }
  _instanceByOrg.clear();
  _initPromiseByOrg.clear();
}

// Proxy exports — delegate to the lazily-cached NextAuth instance
export const handlers = {
  GET: async (...args: unknown[]) => {
    const request = args[0] instanceof Request ? args[0] : null;

    // If DEV_AUTH_BYPASS is enabled, gate every request on localhost origin.
    // A non-local request (tunnels, Codespaces, 0.0.0.0-bound dev servers) is
    // rejected with 403 so the seeded QA session cannot leak to remote clients.
    if (request && isDevAuthBypassEnabled(process.env)) {
      if (isDevAuthBypassRequestAllowed(request, process.env)) {
        if (new URL(request.url).pathname.endsWith("/api/auth/session")) {
          logDevAuthBypassWarning();
          const devSession = getDevAuthBypassSession(process.env, request);
          if (devSession) return Response.json(devSession);
        }
      } else {
        return new Response("Forbidden: DEV_AUTH_BYPASS is restricted to localhost", { status: 403 });
      }
    }

    const instance = await getAuthInstance();
    return instance!.handlers.GET(...(args as Parameters<typeof instance.handlers.GET>));
  },
  POST: async (...args: unknown[]) => {
    const instance = await getAuthInstance();
    return instance!.handlers.POST(...(args as Parameters<typeof instance.handlers.POST>));
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function auth(...args: any[]) {
  const request = args[0] instanceof Request ? args[0] : undefined;
  const devSession = getDevAuthBypassSession(
    process.env,
    request ?? { requestHost: await getRequestHost(), clientAddress: await getClientIp() },
  );
  if (devSession) {
    logDevAuthBypassWarning();
    return devSession;
  }

  const instance = await getAuthInstance();
  return instance!.auth(...args);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function signIn(...args: any[]) {
  const instance = await getAuthInstance();
  return instance!.signIn(...args);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function signOut(...args: any[]) {
  const instance = await getAuthInstance();
  return instance!.signOut(...args);
}

/**
 * Check whether OIDC SSO is configured (for the login page).
 * This is a server-only function.
 */
export async function getOidcStatus(): Promise<{
  enabled: boolean;
  displayName: string;
  localAuthDisabled: boolean;
}> {
  const oidc = await getOidcSettings();
  return {
    enabled: !!oidc,
    displayName: oidc?.displayName ?? "SSO",
    localAuthDisabled: env.VF_DISABLE_LOCAL_AUTH === "true",
  };
}
