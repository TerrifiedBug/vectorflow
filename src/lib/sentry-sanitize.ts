/**
 * Sentry event sanitization.
 *
 * Strips request bodies, query params, and headers that match the
 * denylist BEFORE the event leaves the process. The standard Sentry
 * SDK does some default scrubbing (`request.data` is hashed), but
 * the defaults trust an allowlist model that lets too many sensitive
 * values through under tRPC + multi-tenant routing.
 *
 * What this module does, in order:
 *
 *   1. **Drop the request body entirely.** `event.request.data` is
 *      cleared. We do not need request bodies to diagnose Sentry
 *      errors — the stack trace + exception type + path is enough,
 *      and request bodies on a multi-tenant SaaS frequently contain
 *      customer secrets (pipeline config YAML, agent enrollment
 *      tokens, magic-link tokens redeemed inline).
 *   2. **Drop query params matching DENY_QUERY_KEYS.** Same rationale:
 *      `?token=...` redirects redeem magic-link tokens into Sentry's
 *      indexes otherwise.
 *   3. **Drop headers matching DENY_HEADERS.** `Authorization`,
 *      `Cookie`, `Set-Cookie`, custom auth headers.
 *   4. **Recursively scrub stringly-keyed objects** (extra, contexts,
 *      tags, breadcrumb data) for keys matching DENY_VALUE_KEYS.
 *
 * The denylists are exported for the regression-test harness so the
 * suite can prove every category is enforced.
 */

import type { ErrorEvent } from "@sentry/nextjs";

const REDACTED = "[REDACTED]";

/**
 * Request headers stripped from `event.request.headers`. Case-
 * insensitive comparison; Sentry sometimes lowercases header names.
 */
export const DENY_HEADERS: ReadonlySet<string> = new Set(
  [
    "authorization",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "x-api-key",
    "x-csrf-token",
    "x-trpc-source",
    "x-vf-org-slug",
    "x-vf-csp-nonce",
    "stripe-signature",
  ].map((h) => h.toLowerCase()),
);

/**
 * Query-string keys whose value is dropped from `event.request.query_string`.
 * Sentry receives the full URL; we walk the query string and replace
 * matching values with `[REDACTED]`.
 */
// All entries are lowercase so `DENY_QUERY_KEYS.has(key.toLowerCase())` matches
// case variants without per-lookup normalization of the set itself.
export const DENY_QUERY_KEYS: ReadonlySet<string> = new Set(
  [
    "token",
    "code",
    "secret",
    "key",
    "apikey",
    "api_key",
    "access_token",
    "refresh_token",
    "id_token",
    "client_secret",
    "session",
    "csrftoken",
  ].map((k) => k.toLowerCase()),
);

/**
 * Object keys whose value is `[REDACTED]` wherever they appear in
 * `event.extra`, `event.contexts`, `event.tags`, and breadcrumb data.
 * Recursive walk; matches are case-insensitive.
 */
export const DENY_VALUE_KEYS: ReadonlySet<string> = new Set(
  [
    "password",
    "passwordhash",
    "secret",
    "token",
    "apikey",
    "api_key",
    "encryptedvalue",
    "encryptedsecret",
    "encrypteddata",
    "datakeyciphertext",
    "totpsecret",
    "totpbackupcodes",
    "tokenhash",
    "githubtoken",
    "gittoken",
    "gitwebhooksecret",
    "s3secretaccesskey",
    "clientsecret",
    "oidcclientsecret",
    "stripesigningsecret",
    "stripewebhooksigningsecret",
    "credential",
    "credentials",
    "bearer",
    "authorization",
    "cookie",
    "session",
    "magiclink",
    "magiclinktoken",
    "sessiontoken",
    "session_token",
    "accesstoken",
    "access_token",
    "refreshtoken",
    "refresh_token",
    "idtoken",
    "id_token",
  ].map((k) => k.toLowerCase()),
);

/**
 * Attach per-request log context (org id + request id) as Sentry tags
 * so events can be filtered per tenant. Pure helper — the AsyncLocal-
 * Storage read lives at the call-site so the function is unit-
 * testable without standing up a context store.
 *
 * No-op when neither id is set.
 */
export function applyLogContextTags(
  event: ErrorEvent,
  ctx: { orgId?: string; requestId?: string } | undefined,
): ErrorEvent {
  if (!ctx || (!ctx.orgId && !ctx.requestId)) return event;
  event.tags = {
    ...(event.tags ?? {}),
    ...(ctx.orgId ? { org_id: ctx.orgId } : {}),
    ...(ctx.requestId ? { request_id: ctx.requestId } : {}),
  };
  return event;
}

/**
 * Apply the sanitizer. Returns the mutated event (callers can pass
 * directly to `beforeSend` return).
 */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    // 0. Redact query keys from request.url (full URL includes query string).
    if (typeof event.request.url === "string" && event.request.url.includes("?")) {
      const qIdx = event.request.url.indexOf("?");
      const urlBase = event.request.url.slice(0, qIdx);
      const urlQs = event.request.url.slice(qIdx + 1);
      event.request.url = `${urlBase}?${redactQueryString(urlQs)}`;
    }
    // 1. Drop request body unconditionally.
    if (event.request.data !== undefined) {
      event.request.data = REDACTED;
    }
    // 2. Redact denylisted query keys.
    if (typeof event.request.query_string === "string") {
      event.request.query_string = redactQueryString(
        event.request.query_string,
      );
    } else if (
      event.request.query_string &&
      typeof event.request.query_string === "object"
    ) {
      // Object-shaped query_string: use DENY_QUERY_KEYS (not DENY_VALUE_KEYS)
      // so query-only keys like `code`, `client_secret`, `csrfToken` are redacted.
      // Sentry can also serialize query_string as an array of [key, value] tuples
      // (e.g. [["token","secret"],...]); handle both shapes.
      const rawQs = event.request.query_string;
      if (Array.isArray(rawQs)) {
        // Tuple form: [[key, value], ...]
        event.request.query_string = (rawQs as [string, string][]).map(([k, v]) =>
          DENY_QUERY_KEYS.has(k.toLowerCase()) ? [k, REDACTED] : [k, v],
        ) as typeof event.request.query_string;
      } else {
        // Object form: { key: value, ... }
        const qs = rawQs as Record<string, unknown>;
        const redactedQs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(qs)) {
          // Normalize key to lowercase before denylist lookup so case
          // variants like `Token`, `APIKEY`, or `csrfTOKEN` are redacted.
          redactedQs[k] = DENY_QUERY_KEYS.has(k.toLowerCase()) ? REDACTED : v;
        }
        event.request.query_string = redactedQs as typeof event.request.query_string;
      }
    }
    // 3. Redact denylisted headers.
    if (event.request.headers && typeof event.request.headers === "object") {
      event.request.headers = redactHeaders(event.request.headers);
    }
    // 3b. Redact the parsed cookie jar. Sentry's requestDataIntegration
    // parses the Cookie header into a SEPARATE `event.request.cookies`
    // field (DEFAULT_INCLUDE.cookies = true) even after the Cookie header
    // is dropped at step 3. That jar carries the NextAuth session token
    // (an encrypted JWE bearer credential) and the CSRF token, so it must
    // be scrubbed too — otherwise a captured server error ships a live
    // session to Sentry.
    if (event.request.cookies) {
      event.request.cookies = redactCookies(event.request.cookies);
    }
  }

  // 4. Recursive value-key scrub on extra / contexts / tags /
  // breadcrumb.data.
  if (event.extra) {
    event.extra = scrubObject(event.extra) as typeof event.extra;
  }
  if (event.contexts) {
    event.contexts = scrubObject(event.contexts) as typeof event.contexts;
  }
  if (event.tags) {
    event.tags = scrubObject(event.tags) as typeof event.tags;
  }
  if (event.breadcrumbs) {
    for (const b of event.breadcrumbs) {
      if (b.data) {
        b.data = scrubObject(b.data) as typeof b.data;
      }
    }
  }

  return event;
}

// ─── internals ──────────────────────────────────────────────────────────────

function redactHeaders(
  headers: { [key: string]: string },
): { [key: string]: string } {
  const out: { [key: string]: string } = {};
  for (const [k, v] of Object.entries(headers)) {
    if (DENY_HEADERS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Redact every cookie value. Cookie names are kept for diagnostics; the
 * value (which may be a NextAuth session JWE or CSRF token) is replaced
 * with `[REDACTED]` unconditionally — no cookie value is ever safe to
 * ship to Sentry.
 */
function redactCookies(
  cookies: { [key: string]: string },
): { [key: string]: string } {
  const out: { [key: string]: string } = {};
  for (const k of Object.keys(cookies)) {
    out[k] = REDACTED;
  }
  return out;
}

function redactQueryString(qs: string): string {
  // Sentry sometimes emits a leading "?" — preserve it.
  const leading = qs.startsWith("?") ? "?" : "";
  const body = leading ? qs.slice(1) : qs;
  const parts = body.split("&").map((kv) => {
    const eq = kv.indexOf("=");
    if (eq === -1) return kv;
    const key = kv.slice(0, eq);
    // Decode percent-encoding then normalize to lowercase before denylist lookup
    // so variants like `%74oken`, `Token`, or `APIKEY` are all redacted.
    let decodedKey: string;
    try {
      decodedKey = decodeURIComponent(key).toLowerCase();
    } catch {
      decodedKey = key.toLowerCase();
    }
    if (DENY_QUERY_KEYS.has(decodedKey)) {
      return `${key}=${REDACTED}`;
    }
    return kv;
  });
  return leading + parts.join("&");
}

/**
 * Recursive scrub of an arbitrarily-nested object. Returns a new
 * object — does not mutate the input. Values for keys matching
 * `DENY_VALUE_KEYS` (case-insensitive) are replaced with
 * `[REDACTED]`; other values are walked.
 *
 * Cycle-safe via a WeakSet of seen objects.
 */
function scrubObject(value: unknown, seen?: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  const guard = seen ?? new WeakSet<object>();
  if (guard.has(value as object)) return "[CIRCULAR]";
  guard.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => scrubObject(v, guard));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DENY_VALUE_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = scrubObject(v, guard);
    }
  }
  return out;
}
