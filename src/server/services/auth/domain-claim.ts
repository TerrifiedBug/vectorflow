/**
 * OrganizationDomainClaim service.
 *
 * Surface area:
 *   - `normaliseDomain(input)` — lowercase, punycode, strip leading dot.
 *   - `generateVerificationToken()` — cryptographically random base32.
 *   - `verifyClaimViaDns(claim, resolver?)` — perform the DNS TXT lookup
 *     and return either `{ ok: true }` or `{ ok: false, error }`. The
 *     `resolver` parameter is exposed so tests can inject a stub
 *     without touching `node:dns/promises`.
 *
 * The resolver looks up `_vectorflow.<domain>` for TXT records and
 * succeeds when one of them equals `vf-verify=<verificationToken>`.
 *
 * The router consumes these primitives; persisting verification state
 * is the caller's concern (the router writes `verifiedAt`,
 * `lastCheckedAt`, `lastCheckError`).
 */
import dns from "node:dns/promises";
import { randomBytes } from "node:crypto";

/** DNS prefix where the verification TXT record is published. */
export const DNS_VERIFICATION_PREFIX = "_vectorflow";

/** Prefix on the TXT value distinguishing our record from other tooling. */
export const TXT_VALUE_PREFIX = "vf-verify=";

/** Maximum length accepted for an input domain. RFC 1035 caps at 253. */
const MAX_DOMAIN_LENGTH = 253;

/**
 * Lowercase, punycode, and strip cosmetic noise from a user-supplied
 * domain string. Throws on malformed input.
 */
export function normaliseDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) throw new Error("Domain is empty");
  // Allow scheme so we can helpfully strip it on input, but reject if
  // anything else (path, port) leaks through.
  const withoutScheme = trimmed.replace(/^https?:\/\//, "");
  // Trailing dot is canonical FQDN syntax; drop it before storing.
  const withoutDot = withoutScheme.replace(/\.$/, "");
  if (withoutDot.includes("/") || withoutDot.includes(" ")) {
    throw new Error("Domain must not contain a path or whitespace");
  }
  if (withoutDot.includes(":")) {
    throw new Error("Domain must not include a port");
  }
  if (withoutDot.length > MAX_DOMAIN_LENGTH) {
    throw new Error("Domain exceeds DNS length limit (253 octets)");
  }
  // Reject obviously-malformed shapes: must have at least one dot and
  // every label must be 1–63 chars of [a-z0-9-] without a leading or
  // trailing hyphen.
  const labels = withoutDot.split(".");
  if (labels.length < 2) {
    throw new Error("Domain must include at least one dot");
  }
  for (const label of labels) {
    if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label)) {
      throw new Error(`Invalid DNS label "${label}"`);
    }
  }
  try {
    // URL constructor punycodes IDNs deterministically; round-trip
    // through it to guarantee the stored form is ASCII-only.
    const url = new URL(`https://${withoutDot}`);
    return url.hostname;
  } catch {
    throw new Error("Domain failed punycode normalisation");
  }
}

/**
 * 32 base32 characters of crypto-random data. Strength: 160 bits — more
 * than enough to make the token unguessable on a public TXT record.
 */
export function generateVerificationToken(): string {
  const bytes = randomBytes(20);
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let out = "";
  for (const b of bytes) {
    out += alphabet[b % 32];
  }
  // 20 bytes → 32 base32 chars. The simple modulo approach above
  // yields 20 chars; pad with another fresh batch to hit 32.
  while (out.length < 32) {
    const extra = randomBytes(1)[0]!;
    out += alphabet[extra % 32];
  }
  return out;
}

/**
 * Resolver shape. Production uses `node:dns/promises`; tests inject a
 * stub that returns canned TXT records or throws to simulate NXDOMAIN.
 */
export interface DnsTxtResolver {
  resolveTxt(host: string): Promise<string[][]>;
}

const defaultResolver: DnsTxtResolver = {
  resolveTxt: (host) => dns.resolveTxt(host),
};

/**
 * Outcome of a single verification attempt. `ok=false` carries a
 * human-readable reason for storage in `lastCheckError`.
 */
export type DnsVerificationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Look up `_vectorflow.<domain>` and check that one of the returned
 * TXT records equals `vf-verify=<verificationToken>`.
 *
 * Catches the entire DNS error surface (NXDOMAIN, SERVFAIL, network
 * errors) and maps it to `{ ok: false, error }` so callers don't have
 * to babysit `NodeJS.ErrnoException`.
 */
export async function verifyClaimViaDns(
  args: { domain: string; verificationToken: string },
  resolver: DnsTxtResolver = defaultResolver,
): Promise<DnsVerificationResult> {
  const host = `${DNS_VERIFICATION_PREFIX}.${args.domain}`;
  const expected = `${TXT_VALUE_PREFIX}${args.verificationToken}`;
  let records: string[][];
  try {
    records = await resolver.resolveTxt(host);
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ok: false, error: "NXDOMAIN: no TXT records at " + host };
    }
    if (code === "ESERVFAIL") {
      return { ok: false, error: "SERVFAIL: nameserver returned a transient error" };
    }
    const msg = (err as { message?: string } | undefined)?.message ?? "DNS lookup failed";
    return { ok: false, error: msg };
  }
  if (records.length === 0) {
    return { ok: false, error: `No TXT records at ${host}` };
  }
  // Each record is an array of strings (TXT records can be split into
  // multiple <255-byte chunks). Join chunks to reassemble.
  for (const chunks of records) {
    const joined = chunks.join("");
    if (joined === expected) return { ok: true };
  }
  return {
    ok: false,
    error: `TXT records present at ${host} but none match "${expected}"`,
  };
}
