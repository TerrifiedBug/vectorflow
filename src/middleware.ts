import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * Edge-compatible middleware. Uses the lightweight auth.config.ts
 * which does NOT import Prisma or any Node.js-only modules.
 */
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|login|setup).*)",
  ],
};
