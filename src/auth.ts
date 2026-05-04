import NextAuth, { CredentialsSignin } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { encrypt, decrypt } from "@/server/services/crypto";
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

async function getClientIp(): Promise<string | null> {
  try {
    const hdrs = await headers();
    return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

async function getRequestHost(): Promise<string | null> {
  try {
    const hdrs = await headers();
    return hdrs.get("x-forwarded-host") ?? hdrs.get("host");
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
 * Load OIDC settings from the database.
 * Returns null if OIDC is not configured.
 */
async function getOidcSettings() {
  // Skip DB query during build (no database available)
  if (isBuildPhase) return null;

  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "singleton" },
    });
    if (settings?.oidcIssuer && settings?.oidcClientId && settings?.oidcClientSecret) {
      let clientSecret: string;
      try {
        clientSecret = decrypt(settings.oidcClientSecret);
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
 * Build and cache the NextAuth instance.
 * Re-initializes automatically when invalidateAuthCache() is called
 * (e.g., after OIDC settings change in the admin panel).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthInstance = { handlers: any; auth: any; signIn: any; signOut: any };
let _cached: AuthInstance | null = null;
let _initPromise: Promise<AuthInstance> | null = null;

async function getAuthInstance() {
  if (_cached) return _cached;
  // Deduplicate concurrent init calls
  if (!_initPromise) {
    _initPromise = (async () => {
      const providers: Provider[] = [credentialsProvider];

      const oidc = await getOidcSettings();
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

      const instance = NextAuth({
        ...authConfig,
        adapter: PrismaAdapter(prisma),
        providers,
        callbacks: {
          ...authConfig.callbacks,
          async signIn({ user, account, profile }) {
            // For OIDC sign-ins, auto-create user and team membership with role mapping
            if (account?.provider === "oidc" && user.email) {
              const settings = await prisma.systemSettings.findUnique({
                where: { id: "singleton" },
              });
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
              } else if (dbUser.authMethod === "LOCAL") {
                // Block OIDC login for existing local accounts — admin must explicitly link
                const ipAddress = await getClientIp();
                writeAuditLog({
                  userId: dbUser.id, action: "auth.oidc_link_blocked", entityType: "Auth", entityId: "oidc",
                  ipAddress, userEmail: dbUser.email, userName: dbUser.name,
                  metadata: { reason: "local_account_exists" },
                }).catch(() => {});
                warnLog("auth", `OIDC login blocked: local account exists for ${dbUser.email}. Admin must explicitly link accounts.`);
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
                  await reconcileUserTeamMemberships(tx, dbUser.id, userGroupNames);
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
            return token;
          },
          async session({ session, token }) {
            if (session.user) {
              session.user.id = token.id as string;
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

      _cached = instance;
      _initPromise = null;
      return instance;
    })();
  }
  return _initPromise!;
}

/**
 * Clear the cached NextAuth instance so the next request re-initializes
 * with fresh OIDC settings from the database.
 */
export function invalidateAuthCache() {
  _cached = null;
  _initPromise = null;
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
