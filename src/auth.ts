import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { encrypt, decrypt } from "@/server/services/crypto";
import { verifyTotpCode, verifyBackupCode } from "@/server/services/totp";
import { authConfig } from "@/auth.config";

/**
 * Load OIDC settings from the database.
 * Returns null if OIDC is not configured.
 */
async function getOidcSettings() {
  // Skip DB query during build (no database available)
  if (!process.env.DATABASE_URL) return null;

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
    if (!credentials?.email || !credentials?.password) return null;

    const user = await prisma.user.findUnique({
      where: { email: credentials.email as string },
    });

    if (!user?.passwordHash) return null;
    if (user.lockedAt) return null;

    const valid = await bcrypt.compare(
      credentials.password as string,
      user.passwordHash
    );
    if (!valid) return null;

    // TOTP 2FA check
    if (user.totpEnabled && user.totpSecret) {
      const totpCode = credentials.totpCode as string | undefined;

      if (!totpCode) {
        // Signal the client that TOTP is required
        throw new Error("TOTP_REQUIRED");
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
        throw new Error("Invalid verification code");
      }
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    };
  },
});

/**
 * Build the providers array.
 * Always includes credentials; adds OIDC if configured.
 * This runs once at module load — the OIDC config is cached for the lifetime
 * of the server process. Restart the server after changing OIDC settings.
 */
const providers: Provider[] = [credentialsProvider];

// Load OIDC provider at startup if configured
const oidcSettings = await getOidcSettings();
if (oidcSettings) {
  providers.push({
    id: "oidc",
    name: oidcSettings.displayName,
    type: "oidc",
    issuer: oidcSettings.issuer,
    clientId: oidcSettings.clientId,
    clientSecret: oidcSettings.clientSecret,
    allowDangerousEmailAccountLinking: true,
    client: {
      token_endpoint_auth_method: oidcSettings.tokenEndpointAuthMethod,
    },
  } as Provider);
  console.log(`OIDC provider registered: ${oidcSettings.displayName} (${oidcSettings.issuer})`);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
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
        const groupsClaim = settings?.oidcGroupsClaim ?? "groups";
        const profileData = profile as Record<string, unknown> | undefined;
        const userGroups = (profileData?.[groupsClaim] as string[] | undefined) ?? [];

        // Ensure user exists in the database
        let dbUser = await prisma.user.findUnique({
          where: { email: user.email },
        });
        if (!dbUser) {
          dbUser = await prisma.user.create({
            data: {
              email: user.email,
              name: user.name ?? profile?.name ?? user.email.split("@")[0],
              authMethod: "OIDC",
            },
          });
        } else if (dbUser.authMethod === "LOCAL") {
          // SSO takeover: convert local user to OIDC (removes local login)
          await prisma.user.update({
            where: { id: dbUser.id },
            data: { authMethod: "OIDC", passwordHash: null },
          });
        }

        // Parse team mappings (new system)
        const teamMappings: Array<{group: string; teamId: string; role: string}> =
          settings?.oidcTeamMappings ? (() => { try { return JSON.parse(settings.oidcTeamMappings!); } catch { return []; } })() : [];

        if (teamMappings.length > 0) {
          // New team mapping logic
          const matchedMappings = teamMappings.filter((m) => userGroups.includes(m.group));

          if (matchedMappings.length > 0) {
            // Group by teamId, take highest role per team
            const roleLevel: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };
            const teamRoleMap = new Map<string, string>();
            for (const m of matchedMappings) {
              const current = teamRoleMap.get(m.teamId);
              if (!current || (roleLevel[m.role] ?? 0) > (roleLevel[current] ?? 0)) {
                teamRoleMap.set(m.teamId, m.role);
              }
            }

            // Create or update memberships for matched teams
            for (const [teamId, role] of teamRoleMap) {
              const membership = await prisma.teamMember.findUnique({
                where: { userId_teamId: { userId: dbUser.id, teamId } },
              });
              if (!membership) {
                await prisma.teamMember.create({
                  data: { userId: dbUser.id, teamId, role: role as "VIEWER" | "EDITOR" | "ADMIN" },
                });
              } else {
                await prisma.teamMember.update({
                  where: { id: membership.id },
                  data: { role: role as "VIEWER" | "EDITOR" | "ADMIN" },
                });
              }
            }
          } else if (settings?.oidcDefaultTeamId) {
            // No mappings matched — assign to default team with default role
            const defaultRole = settings.oidcDefaultRole ?? "VIEWER";
            const membership = await prisma.teamMember.findUnique({
              where: { userId_teamId: { userId: dbUser.id, teamId: settings.oidcDefaultTeamId } },
            });
            if (!membership) {
              await prisma.teamMember.create({
                data: { userId: dbUser.id, teamId: settings.oidcDefaultTeamId, role: defaultRole },
              });
            }
          }
        }

        user.id = dbUser.id;
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
});

/**
 * Check whether OIDC SSO is configured (for the login page).
 * This is a server-only function.
 */
export async function getOidcStatus(): Promise<{
  enabled: boolean;
  displayName: string;
}> {
  const oidc = await getOidcSettings();
  return {
    enabled: !!oidc,
    displayName: oidc?.displayName ?? "SSO",
  };
}
