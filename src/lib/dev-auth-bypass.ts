import type { Session } from "next-auth";

type EnvLike = Record<string, string | undefined>;
type RequestOptions = { requestHost?: string | null };

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

function hostnameFromHostHeader(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    return trimmed.slice(1, trimmed.indexOf("]"));
  }

  return trimmed.split(":")[0] ?? "";
}

function isLocalhost(host: string | null | undefined): boolean {
  if (!host) return false;

  const hostname = hostnameFromHostHeader(host);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isDevAuthBypassEnabledForRequest(
  env: EnvLike = process.env,
  options: RequestOptions = {},
): boolean {
  if (!isDevAuthBypassEnabled(env)) return false;
  if (isLocalhost(options.requestHost)) return true;

  return env.DEV_AUTH_BYPASS_ALLOW_NETWORK === "1";
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
  options: RequestOptions = {},
): Session | null {
  if (!isDevAuthBypassEnabledForRequest(env, options)) return null;

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
