import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * Next.js proxy (auth gate). Uses the lightweight auth.config.ts
 * which does NOT import Prisma or any Node.js-only modules.
 */
const { auth } = NextAuth(authConfig);

export const proxy = auth;

export const config = {
  matcher: [
    "/((?!api/auth|api/v1|api/agent|api/scim|_next/static|_next/image|favicon.ico|login|setup).*)",
  ],
};
