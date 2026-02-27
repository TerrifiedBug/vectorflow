import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Shared auth configuration used by both the full auth setup (auth.ts)
 * and the Edge middleware. This file must NOT import Prisma or any
 * Node.js-only modules, since it runs in the Edge Runtime.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
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
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAuthPage =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/setup");
      const isApiAuth = nextUrl.pathname.startsWith("/api/auth");
      const isHealth = nextUrl.pathname.startsWith("/api/health");

      // Always allow auth pages, auth API, and health check
      if (isAuthPage || isApiAuth || isHealth) return true;

      // Redirect unauthenticated users to login
      if (!isLoggedIn) return false;

      return true;
    },
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
};
