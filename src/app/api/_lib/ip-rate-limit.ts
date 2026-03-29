import { rateLimiter } from "@/app/api/v1/_lib/rate-limiter";

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    return parts[parts.length - 1].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}

/**
 * Check an IP-keyed rate limit for unauthenticated endpoints.
 * Returns a 429 Response if the limit is exceeded, or null if allowed.
 */
export function checkIpRateLimit(
  request: Request,
  endpoint: string,
  limit: number,
): Response | null {
  const ip = getClientIp(request);
  const key = `ip:${endpoint}:${ip}`;

  const result = rateLimiter.checkKey(key, limit);

  if (!result.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfter),
      },
    });
  }

  return null;
}
