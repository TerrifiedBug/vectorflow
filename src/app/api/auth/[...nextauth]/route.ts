import { handlers } from "@/auth";
import { checkIpRateLimit } from "@/app/api/_lib/ip-rate-limit";

export const GET = handlers.GET;

/**
 * Wrap the NextAuth POST handler with IP-based rate limiting for login
 * endpoints. This blocks brute-force attacks at the network edge before
 * NextAuth (and therefore the database) is even consulted.
 *
 * Limits:
 *  - /api/auth/callback/credentials — 5 attempts/min per IP
 *  - /api/auth/callback/oidc        — 20 requests/min per IP (redirect abuse)
 */
export async function POST(request: Request, context: unknown) {
  const { pathname } = new URL(request.url);

  if (pathname.endsWith("/callback/credentials")) {
    const limited = checkIpRateLimit(request, "auth:credentials", 5);
    if (limited) return limited;
  } else if (pathname.endsWith("/callback/oidc")) {
    const limited = checkIpRateLimit(request, "auth:oidc", 20);
    if (limited) return limited;
  }

  return handlers.POST(request, context);
}
