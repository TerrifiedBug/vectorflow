import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { isDevAuthBypassRequestAllowed } from "@/lib/dev-auth-bypass";
import { strictCookieConfig } from "@/lib/strict-cookies";

/**
 * Shared auth configuration used by both the full auth setup (auth.ts)
 * and the Edge middleware. This file must NOT import Prisma or any
 * Node.js-only modules, since it runs in the Edge Runtime.
 */
export const authConfig: NextAuthConfig = {
  // 24h sessions (suite SSO contract): CHAD trusts the shared cookie
  // without a per-request role re-check, so cap staleness at one day.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 },
  // Use `strictCookieConfig()` to enable per-subdomain cookie isolation
  // when configured; otherwise use NextAuth defaults for development.
  ...(strictCookieConfig() ? { cookies: strictCookieConfig() } : {}),
  pages: {
    signIn: "/login",
  },
  providers: [
    // Credentials provider stub for the middleware — the real authorize
    // logic lives in auth.ts and only runs in the Node.js runtime.
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const isLoggedIn = !!auth?.user;
      const isAuthPage =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/setup");
      const isApiAuth = nextUrl.pathname.startsWith("/api/auth");
      const isHealth = nextUrl.pathname.startsWith("/api/health");
      const isSetupApi = nextUrl.pathname.startsWith("/api/setup");
      const isApiV1 = nextUrl.pathname.startsWith("/api/v1");
      const isAgentApi = nextUrl.pathname.startsWith("/api/agent");
      const isScimApi = nextUrl.pathname.startsWith("/api/scim");

      // Always allow auth pages, auth API, health check, setup API,
      // REST API v1 (uses Bearer token auth), agent API (uses enrollment tokens),
      // and SCIM API (uses bearer token auth)
      if (isAuthPage || isApiAuth || isHealth || isSetupApi || isApiV1 || isAgentApi || isScimApi) return true;

      if (isDevAuthBypassRequestAllowed(request)) return true;

      // Redirect unauthenticated users to login
      if (!isLoggedIn) return false;

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      // org_id is stamped by auth.ts's full jwt callback (Node.js runtime)
      // and lives on the token as a persistent claim. Preserve it here so
      // the Edge middleware can read it via the session callback below.
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        // Expose org binding on the session so the middleware authorized
        // callback and server components can read it without decoding the JWT.
        if (token.org_id) {
          session.user.org_id = token.org_id as string;
        }
      }
      return session;
    },
  },
};
