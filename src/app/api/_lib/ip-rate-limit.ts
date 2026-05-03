import { rateLimiter } from "@/app/api/v1/_lib/rate-limiter";
import crypto from "crypto";

function getClientIp(request: Request): string {
  if (process.env.VF_TRUST_PROXY_HEADERS !== "true") {
    return "unknown";
  }

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

/**
 * Extract the raw bearer token from the Authorization header.
 * Returns null if the header is missing or not in "Bearer <token>" format.
 */
function extractBearer(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Check a token-keyed rate limit for authenticated agent endpoints.
 * Returns a 401 Response if no bearer token is present,
 * a 429 Response if the limit is exceeded, or null if allowed.
 */
export function checkTokenRateLimit(
  request: Request,
  endpoint: string,
  limit: number,
): Response | null {
  const token = extractBearer(request);
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const key = `token:${endpoint}:${tokenHash}`;
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
