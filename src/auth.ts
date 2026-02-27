import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { decrypt } from "@/server/services/crypto";

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

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
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
