/**
 * Hardened webhook delivery.
 *
 * Three mitigations layered on top of the existing `fetch`-based outbound
 * delivery:
 *
 *   1. **Manual redirect handling with a cap (max 3 hops).**
 *      Browsers transparently follow up to 20 redirects. For outbound
 *      webhooks where the destination is customer-controlled we MUST cap
 *      it AND re-validate each Location header — otherwise a server can
 *      `302` us into a private IP after `validatePublicUrl` cleared the
 *      original URL. We also REJECT protocol downgrades (https -> http).
 *
 *   2. **DNS rebinding mitigation (cache-then-reuse-IP).**
 *      Between `validatePublicUrl` resolving the hostname and the actual
 *      TCP connect, DNS can flip its answer to a private IP. We resolve
 *      once, cache the IP set for 30s, and re-resolve at each redirect
 *      hop. The cached set is intersected with "still public" at use
 *      time. This does NOT pin the connection to a specific IP — that
 *      would require a custom dispatcher and break TLS SNI — but it does
 *      catch rebinding attacks that flip mid-request.
 *
 *   3. **One-time confirmation.**
 *      `WebhookEndpoint.confirmedAt IS NULL` short-circuits to a
 *      non-retryable failure. The confirmation is set after the org
 *      owner clicks the one-time link from
 *      `mintWebhookConfirmation`.
 *
 * The existing un-hardened `deliverOutboundWebhook` in `outbound-webhook.ts`
 * is preserved as-is (it's exercised by 25+ tests and used by every
 * production path). This module is the migration target: callers flip
 * over by importing `deliverOutboundWebhookHardened` instead.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { isPrivateIP, validateOutboundUrl } from "@/server/services/url-validation";

const MAX_REDIRECTS = 3;
const DNS_CACHE_TTL_MS = 30_000;

interface CachedDnsAnswer {
  addresses: string[];
  expiresAt: number;
}

const dnsCache = new Map<string, CachedDnsAnswer>();

/**
 * Permanent (host-genuinely-does-not-exist) DNS error codes. Anything
 * NOT in this set is treated as transient and the caller falls back to
 * the retry loop instead of dead-lettering. Cf. Codex P1 follow-up on
 * PR #342 — `catch(() => [])` was conflating SERVFAIL with NXDOMAIN.
 */
const PERMANENT_DNS_CODES = new Set<string>([
  "ENOTFOUND",
  "ENODATA",
  "ENONAME",
]);

interface ResolveOutcome {
  addresses: string[];
  /** Set iff the underlying `dns.resolveN` threw a transient error. */
  transientError: NodeJS.ErrnoException | null;
}

async function safeResolve(
  fn: () => Promise<string[]>,
): Promise<ResolveOutcome> {
  try {
    return { addresses: await fn(), transientError: null };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code && PERMANENT_DNS_CODES.has(e.code)) {
      // Permanent — no such record for this family. Empty answer is the
      // signal; the caller intersects across both families before
      // deciding it really is a dead-letter.
      return { addresses: [], transientError: null };
    }
    return { addresses: [], transientError: e };
  }
}

/**
 * Resolve `hostname` to public IPs only. Cached for 30s to defeat
 * rebinding attacks that flip the DNS answer between validation and
 * connect. Throws when:
 *   - the hostname doesn't resolve at all, OR
 *   - ANY returned IP is private/reserved (we treat split-answer as
 *     hostile rather than picking the public IPs — defence in depth).
 *
 * IP-literal hostnames (e.g. `203.0.113.10`, `[2001:db8::1]`) are
 * short-circuited: `validateOutboundUrl({ force: true })` upstream has
 * already verified the literal is public, and `dns.resolve4/resolve6`
 * on an IP literal returns no records on most platforms — re-resolving
 * would falsely reject the request as "did not resolve". Cf. Codex P1
 * on PR #335.
 *
 * For tests, exported so the cache can be cleared via `_resetDnsCache`.
 */
export async function resolveHostnamePublic(
  hostname: string,
  now: () => number = Date.now,
): Promise<string[]> {
  // IPv4/IPv6 literal — no DNS to resolve. `URL.hostname` for IPv6
  // URLs is bracketed (`[2001:db8::1]`) but `net.isIP` only accepts
  // the bare form, so strip a leading `[` / trailing `]` first. Cf.
  // Codex P1 follow-up on PR #342.
  const unbracketed =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (net.isIP(unbracketed) !== 0) {
    return [unbracketed];
  }

  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > now()) {
    return cached.addresses;
  }

  // Resolve both families. We have to distinguish:
  //
  //   * a definitive "host does not exist" answer (ENOTFOUND / ENODATA /
  //     ENONAME, or an empty array on success) — permanent failure,
  //     dead-letter the delivery, AND
  //   * a transient resolver problem (SERVFAIL, TIMEOUT, EAI_AGAIN,
  //     REFUSED, …) — retryable, the destination might be perfectly
  //     fine and the resolver itself is having a bad day.
  //
  // The previous shape (`catch(() => [])`) collapsed both buckets into
  // "no answer → DnsRebindingError → dead-letter", which dropped real
  // webhooks during brief DNS incidents. Cf. Codex P1 follow-up on PR #342.
  const [v4, v6] = await Promise.all([
    safeResolve(() => dns.resolve4(hostname)),
    safeResolve(() => dns.resolve6(hostname)),
  ]);
  const all = [...v4.addresses, ...v6.addresses];
  if (all.length === 0) {
    // If EITHER family threw a transient error, surface as a plain
    // Error so the retry loop treats it as retryable. Only when both
    // families returned a definitive no-answer do we dead-letter.
    const transient = v4.transientError ?? v6.transientError;
    if (transient) {
      throw new Error(
        `DNS resolver problem for ${hostname}: ${transient.message}`,
      );
    }
    throw new DnsRebindingError(
      `DNS: hostname ${hostname} did not resolve`,
    );
  }
  for (const ip of all) {
    if (isPrivateIP(ip)) {
      throw new DnsRebindingError(
        `DNS: hostname ${hostname} resolved to a private IP (${ip}); ` +
          "treating as rebinding attempt",
      );
    }
  }

  dnsCache.set(hostname, {
    addresses: all,
    expiresAt: now() + DNS_CACHE_TTL_MS,
  });
  return all;
}

/** Exported for tests so each case starts with a clean cache. */
export function _resetDnsCache(): void {
  dnsCache.clear();
}

export interface HardenedFetchResult {
  status: number;
  ok: boolean;
  redirectChain: string[];
}

export class WebhookRedirectError extends Error {
  readonly _tag = "WebhookRedirectError" as const;
}

/**
 * DNS-rebinding-policy violation thrown by `resolveHostnamePublic`:
 * either no answer at all, or an answer containing a private IP. These
 * are non-retryable — the destination's DNS is hostile or broken; no
 * amount of retrying will change that. Callers MUST classify this as
 * permanent. Cf. Codex P2 on PR #335.
 */
export class DnsRebindingError extends Error {
  readonly _tag = "DnsRebindingError" as const;
}

/**
 * `fetch` with: manual redirect handling, max 3 hops, per-hop URL
 * re-validation (`validateOutboundUrl({ force: true })` AND
 * `resolveHostnamePublic`), and protocol-downgrade rejection.
 *
 * Returns `{ status, ok, redirectChain }`. The caller decides whether
 * to treat 3xx (after we exhausted MAX_REDIRECTS) as a permanent or
 * retryable failure.
 */
export async function fetchHardened(
  url: string,
  init: Omit<RequestInit, "redirect">,
  opts: { now?: () => number } = {},
): Promise<HardenedFetchResult> {
  const now = opts.now ?? Date.now;
  const redirectChain: string[] = [];
  let currentUrl = url;
  let originalProtocol: string | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new WebhookRedirectError(`Invalid URL at hop ${hop}: ${currentUrl}`);
    }

    if (originalProtocol === null) {
      originalProtocol = parsed.protocol;
    } else if (originalProtocol === "https:" && parsed.protocol === "http:") {
      throw new WebhookRedirectError(
        `Refusing protocol downgrade (https -> http) at hop ${hop}: ${currentUrl}`,
      );
    }

    // Per-hop SSRF + scheme re-validation. `{ force: true }` so the policy
    // applies regardless of `VF_STRICT_OUTBOUND` — a redirect is a
    // customer-controlled action.
    await validateOutboundUrl(currentUrl, { force: true });
    // Per-hop DNS rebinding check.
    await resolveHostnamePublic(parsed.hostname, now);

    redirectChain.push(currentUrl);
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });

    if (res.status < 300 || res.status >= 400) {
      // Not a redirect — return.
      return { status: res.status, ok: res.ok, redirectChain };
    }

    if (hop === MAX_REDIRECTS) {
      throw new WebhookRedirectError(
        `Exceeded MAX_REDIRECTS (${MAX_REDIRECTS}) at ${currentUrl}`,
      );
    }

    const location = res.headers.get("location");
    if (!location) {
      throw new WebhookRedirectError(
        `Redirect ${res.status} from ${currentUrl} without Location header`,
      );
    }
    // Resolve relative redirects against the current URL.
    currentUrl = new URL(location, currentUrl).toString();
  }

  // Unreachable — the loop returns/throws inside.
  throw new WebhookRedirectError("redirect loop logic invariant violated");
}
