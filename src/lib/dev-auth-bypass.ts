import type { Session } from "next-auth";

type EnvLike = Record<string, string | undefined>;
type RequestOptions = { requestHost?: string | null; clientAddress?: string | null };

type RequestLike = {
  headers: Headers;
  url: string;
};

export const QA_DEV_USER = {
  id: "qa-user",
  email: "qa@vectorflow.local",
  name: "QA Dev User",
} as const;

let warningLogged = false;

export function isDevAuthBypassEnabled(env: EnvLike = process.env): boolean {
  if (env.DEV_AUTH_BYPASS !== "1") return false;
  if (env.NODE_ENV === "production") {
    throw new Error("DEV_AUTH_BYPASS cannot be enabled when NODE_ENV=production");
  }
  return true;
}

function normalizeAddress(value: string): string {
  const address = value.trim().toLowerCase();
  if (address.startsWith("[")) {
    return address.slice(1, address.indexOf("]"));
  }

  const colonCount = address.split(":").length - 1;
  if (colonCount === 1) {
    return address.split(":")[0] ?? "";
  }

  return address;
}

function isLocalAddress(value: string | null | undefined): boolean {
  if (!value) return false;

  const address = normalizeAddress(value);
  if (address === "localhost" || address === "::1" || address === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (address.startsWith("::ffff:")) {
    return isLocalAddress(address.slice("::ffff:".length));
  }

  const octets = address.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every((octet) => /^\d+$/.test(octet));
}

function forwardedClientAddress(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || headers.get("x-real-ip")?.trim() || null;
}

function hasForwardedProxyHeaders(headers: Headers): boolean {
  return (
    headers.has("x-forwarded-for") ||
    headers.has("x-real-ip") ||
    headers.has("x-forwarded-host")
  );
}

export function isDevAuthBypassEnabledForRequest(
  env: EnvLike = process.env,
  options: RequestOptions = {},
): boolean {
  if (!isDevAuthBypassEnabled(env)) return false;
  if (env.DEV_AUTH_BYPASS_ALLOW_NETWORK === "1") return true;

  return isLocalAddress(options.requestHost) && isLocalAddress(options.clientAddress);
}

export function isDevAuthBypassRequestAllowed(
  request: RequestLike,
  env: EnvLike = process.env,
): boolean {
  if (!isDevAuthBypassEnabled(env)) return false;
  if (env.DEV_AUTH_BYPASS_ALLOW_NETWORK === "1") return true;

  const requestHost = new URL(request.url).host;
  if (!isLocalAddress(requestHost)) return false;

  if (env.VF_TRUST_PROXY_HEADERS === "true") {
    return isLocalAddress(forwardedClientAddress(request.headers));
  }

  return !hasForwardedProxyHeaders(request.headers);
}

export function logDevAuthBypassWarning(env: EnvLike = process.env): void {
  if (!isDevAuthBypassEnabled(env) || warningLogged) return;
  warningLogged = true;
  console.warn(
    "[auth] DEV_AUTH_BYPASS=1 is enabled. This development-only mode bypasses interactive authentication for the seeded QA user.",
  );
}

export function getDevAuthBypassSession(
  env: EnvLike = process.env,
  options: RequestOptions | RequestLike = {},
): Session | null {
  const enabled = "headers" in options
    ? isDevAuthBypassRequestAllowed(options, env)
    : isDevAuthBypassEnabledForRequest(env, options);
  if (!enabled) return null;

  const user = {
    id: env.DEV_AUTH_BYPASS_USER_ID ?? QA_DEV_USER.id,
    email: env.DEV_AUTH_BYPASS_USER_EMAIL ?? QA_DEV_USER.email,
    name: env.DEV_AUTH_BYPASS_USER_NAME ?? QA_DEV_USER.name,
    image: null,
  };

  return {
    user,
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}
