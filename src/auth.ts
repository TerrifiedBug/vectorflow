import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { decrypt } from "@/server/services/crypto";
import { authConfig } from "@/auth.config";

/**
 * Load OIDC settings from the database.
 * Returns null if OIDC is not configured.
 */
async function getOidcSettings() {
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
  },
  async authorize(credentials) {
    if (!credentials?.email || !credentials?.password) return null;

    const user = await prisma.user.findUnique({
      where: { email: credentials.email as string },
    });

    if (!user?.passwordHash) return null;

    const valid = await bcrypt.compare(
      credentials.password as string,
      user.passwordHash
    );
    if (!valid) return null;

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
        // Load role mapping settings
        const settings = await prisma.systemSettings.findUnique({
          where: { id: "singleton" },
        });
        const defaultRole = settings?.oidcDefaultRole ?? "VIEWER";
        const groupsClaim = settings?.oidcGroupsClaim ?? "groups";
        const adminGroups = settings?.oidcAdminGroups?.split(",").map((g) => g.trim()).filter(Boolean) ?? [];
        const editorGroups = settings?.oidcEditorGroups?.split(",").map((g) => g.trim()).filter(Boolean) ?? [];

        // Determine role from OIDC groups claim
        const profileData = profile as Record<string, unknown> | undefined;
        const userGroups = (profileData?.[groupsClaim] as string[] | undefined) ?? [];
        let assignedRole: "VIEWER" | "EDITOR" | "ADMIN" = defaultRole as "VIEWER" | "EDITOR" | "ADMIN";
        if (adminGroups.length > 0 && userGroups.some((g) => adminGroups.includes(g))) {
          assignedRole = "ADMIN";
        } else if (editorGroups.length > 0 && userGroups.some((g) => editorGroups.includes(g))) {
          assignedRole = "EDITOR";
        }

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
          await prisma.user.update({
            where: { id: dbUser.id },
            data: { authMethod: "BOTH" },
          });
        }

        // Auto-add to the first team with mapped role, or update existing role
        const teams = await prisma.team.findMany({ take: 1 });
        if (teams.length > 0) {
          const membership = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId: dbUser.id, teamId: teams[0].id } },
          });
          if (!membership) {
            await prisma.teamMember.create({
              data: { userId: dbUser.id, teamId: teams[0].id, role: assignedRole },
            });
          } else if (adminGroups.length > 0 || editorGroups.length > 0) {
            // Update role on each login if group mapping is configured
            await prisma.teamMember.update({
              where: { id: membership.id },
              data: { role: assignedRole },
            });
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
