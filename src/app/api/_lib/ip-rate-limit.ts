import { rateLimiter } from "@/app/api/v1/_lib/rate-limiter";
import crypto from "crypto";

function getClientIp(request: Request): string {
  const trustedProxies = parseTrustedProxies();
  const legacyMode =
    trustedProxies.length === 0 && process.env.VF_TRUST_PROXY_HEADERS === "true";

  if (trustedProxies.length === 0 && !legacyMode) {
    return "unknown";
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return "unknown";

    if (legacyMode) {
      return parts[0];
    }

    if (parts.length === 1) {
      return parts[0];
    }

    let index = parts.length - 1;
    if (!isTrustedProxy(parts[index], trustedProxies)) {
      return "unknown";
    }

    while (index >= 0 && isTrustedProxy(parts[index], trustedProxies)) {
      index -= 1;
    }

    return parts[index] ?? "unknown";
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

type TrustedProxy = { type: "exact"; value: string } | { type: "cidr"; base: number; mask: number };

function parseTrustedProxies(): TrustedProxy[] {
  return (process.env.VF_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [ip, prefix] = entry.split("/");
      if (prefix !== undefined) {
        const bits = Number(prefix);
        const parsed = parseIpv4(ip);
        if (parsed !== null && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
          const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
          return { type: "cidr" as const, base: parsed & mask, mask };
        }
      }
      return { type: "exact" as const, value: entry.toLowerCase() };
    });
}

function isTrustedProxy(ip: string, trustedProxies: TrustedProxy[]): boolean {
  const normalized = ip.toLowerCase();
  const ipv4 = parseIpv4(normalized);

  return trustedProxies.some((proxy) => {
    if (proxy.type === "exact") return proxy.value === normalized;
    return ipv4 !== null && (ipv4 & proxy.mask) === proxy.base;
  });
}

function parseIpv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

/**
 * Check an IP-keyed rate limit for unauthenticated endpoints.
 * Returns a 429 Response if the limit is exceeded, or null if allowed.
 */
export async function checkIpRateLimit(
  request: Request,
  endpoint: string,
  limit: number,
): Promise<Response | null> {
  const ip = getClientIp(request);
  const key = `ip:${endpoint}:${ip}`;

  const result = await rateLimiter.checkKey(key, limit);
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
export async function checkTokenRateLimit(
  request: Request,
  endpoint: string,
  limit: number,
): Promise<Response | null> {
  const token = extractBearer(request);
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const key = `token:${endpoint}:${tokenHash}`;
  const result = await rateLimiter.checkKey(key, limit);
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
