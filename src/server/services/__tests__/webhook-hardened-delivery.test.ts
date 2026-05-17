/**
 * Phase 5aa: redirect cap + DNS rebinding mitigation.
 *
 * `validateOutboundUrl` is exercised by `validate-outbound-url.test.ts`;
 * we mock it here to focus on the redirect / DNS-cache wiring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockValidateOutboundUrl = vi.fn();
const mockIsPrivateIP = vi.fn();

vi.mock("@/server/services/url-validation", () => ({
  validateOutboundUrl: (...args: unknown[]) => mockValidateOutboundUrl(...args),
  isPrivateIP: (...args: unknown[]) => mockIsPrivateIP(...args),
}));

const mockResolve4 = vi.fn();
const mockResolve6 = vi.fn();
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: (...args: unknown[]) => mockResolve4(...args),
    resolve6: (...args: unknown[]) => mockResolve6(...args),
  },
}));

import {
  DnsRebindingError,
  WebhookRedirectError,
  _resetDnsCache,
  fetchHardened,
  resolveHostnamePublic,
} from "@/server/services/webhook-hardened-delivery";

const fetchSpy = vi.fn();

beforeEach(() => {
  _resetDnsCache();
  fetchSpy.mockReset();
  mockValidateOutboundUrl.mockReset().mockResolvedValue(undefined);
  mockIsPrivateIP.mockReset().mockReturnValue(false);
  mockResolve4.mockReset().mockResolvedValue(["8.8.8.8"]);
  mockResolve6.mockReset().mockResolvedValue([]);
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRes(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe("resolveHostnamePublic", () => {
  it("returns the resolved addresses for a public hostname", async () => {
    mockResolve4.mockResolvedValueOnce(["8.8.8.8"]);
    mockResolve6.mockResolvedValueOnce([]);
    await expect(resolveHostnamePublic("dns.google")).resolves.toEqual([
      "8.8.8.8",
    ]);
  });

  it("rejects when any address is private (split-answer rebinding)", async () => {
    mockResolve4.mockResolvedValueOnce(["8.8.8.8", "10.0.0.1"]);
    mockResolve6.mockResolvedValueOnce([]);
    mockIsPrivateIP.mockImplementation((ip: string) => ip.startsWith("10."));

    await expect(resolveHostnamePublic("rebind.example")).rejects.toThrow(
      /private IP/,
    );
  });

  it("rejects when no addresses resolve", async () => {
    mockResolve4.mockResolvedValueOnce([]);
    mockResolve6.mockResolvedValueOnce([]);
    await expect(resolveHostnamePublic("nx.example")).rejects.toThrow(
      /did not resolve/,
    );
  });

  it("caches results for 30s (deterministic clock)", async () => {
    mockResolve4.mockResolvedValueOnce(["8.8.8.8"]);
    mockResolve6.mockResolvedValueOnce([]);
    const now1 = vi.fn().mockReturnValue(1_000_000);
    await resolveHostnamePublic("cache.example", now1);
    // Second call within TTL must not re-query DNS.
    await resolveHostnamePublic("cache.example", now1);
    expect(mockResolve4).toHaveBeenCalledTimes(1);
  });

  it("re-queries DNS once the cache TTL expires", async () => {
    mockResolve4.mockResolvedValue(["8.8.8.8"]);
    mockResolve6.mockResolvedValue([]);
    const now = vi.fn().mockReturnValueOnce(1_000_000); // first fetch caches at +30s
    await resolveHostnamePublic("ttl.example", now);
    // Advance past the 30s TTL.
    now.mockReturnValueOnce(1_000_000 + 31_000);
    await resolveHostnamePublic("ttl.example", now);
    expect(mockResolve4).toHaveBeenCalledTimes(2);
  });

  // Codex P1 / PR #335 follow-up: IP literals must NOT be re-resolved.
  // `dns.resolve4/resolve6` on a literal returns no records, which used
  // to throw "did not resolve" and break delivery to existing IP-only
  // endpoints. `validateOutboundUrl({ force: true })` upstream already
  // verified the literal is public.
  it("short-circuits IPv4 literal hostnames (no DNS query, no cache)", async () => {
    await expect(resolveHostnamePublic("203.0.113.10")).resolves.toEqual([
      "203.0.113.10",
    ]);
    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
  });

  it("short-circuits IPv6 literal hostnames (bracketed, as URL.hostname emits)", async () => {
    // `new URL("https://[2001:db8::1]/x").hostname === "[2001:db8::1]"`.
    // The short-circuit must accept both bracketed and bare forms — and
    // canonicalise to bare. Cf. Codex P1 follow-up on PR #342.
    await expect(resolveHostnamePublic("[2001:db8::1]")).resolves.toEqual([
      "2001:db8::1",
    ]);
    await expect(resolveHostnamePublic("2001:db8::1")).resolves.toEqual([
      "2001:db8::1",
    ]);
    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
  });

  it("matches the hostname URL would actually hand us for IPv6 webhooks", async () => {
    // End-to-end shape check: `fetchHardened` always passes
    // `parsed.hostname` from `new URL(...)`, so verify that exact
    // string round-trips through the short-circuit.
    const hostname = new URL("https://[2001:db8::1]/hook").hostname;
    await expect(resolveHostnamePublic(hostname)).resolves.toEqual([
      "2001:db8::1",
    ]);
    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
  });

  // Codex P2 / PR #335 follow-up: rebinding/no-answer errors must be
  // a typed `DnsRebindingError`, not a plain `Error`. The webhook retry
  // classifier matches on `instanceof DnsRebindingError` to dead-letter
  // these instead of rescheduling them forever.
  it("throws DnsRebindingError (typed) on no answer", async () => {
    mockResolve4.mockResolvedValueOnce([]);
    mockResolve6.mockResolvedValueOnce([]);
    await expect(resolveHostnamePublic("nx2.example")).rejects.toBeInstanceOf(
      DnsRebindingError,
    );
  });

  it("throws DnsRebindingError (typed) on split-answer", async () => {
    mockResolve4.mockResolvedValueOnce(["8.8.8.8", "10.0.0.1"]);
    mockResolve6.mockResolvedValueOnce([]);
    mockIsPrivateIP.mockImplementation((ip: string) => ip.startsWith("10."));
    await expect(
      resolveHostnamePublic("rebind2.example"),
    ).rejects.toBeInstanceOf(DnsRebindingError);
  });

  // Codex P1 follow-up on PR #342: distinguish transient resolver
  // problems (SERVFAIL, TIMEOUT, EAI_AGAIN) from "host does not exist"
  // (ENOTFOUND/ENODATA/ENONAME). Transient → plain Error → retryable.
  // Permanent → DnsRebindingError → dead-letter.
  function dnsErr(code: string, msg: string): NodeJS.ErrnoException {
    const e = new Error(msg) as NodeJS.ErrnoException;
    e.code = code;
    return e;
  }

  it("throws a plain Error (retryable) when resolve4 fails with SERVFAIL", async () => {
    mockResolve4.mockRejectedValueOnce(dnsErr("ESERVFAIL", "queryA ESERVFAIL"));
    mockResolve6.mockResolvedValueOnce([]);
    const err = await resolveHostnamePublic("blip.example").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DnsRebindingError);
    expect(err.message).toMatch(/resolver problem/);
  });

  it("throws a plain Error (retryable) when resolve6 fails with EAI_AGAIN", async () => {
    mockResolve4.mockResolvedValueOnce([]);
    mockResolve6.mockRejectedValueOnce(
      dnsErr("EAI_AGAIN", "queryAaaa EAI_AGAIN"),
    );
    const err = await resolveHostnamePublic("blip2.example").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DnsRebindingError);
  });

  it("throws a plain Error (retryable) when BOTH families fail transiently", async () => {
    mockResolve4.mockRejectedValueOnce(dnsErr("ETIMEOUT", "timeout v4"));
    mockResolve6.mockRejectedValueOnce(dnsErr("ESERVFAIL", "servfail v6"));
    const err = await resolveHostnamePublic("blip3.example").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DnsRebindingError);
  });

  it("throws DnsRebindingError only when both families return ENOTFOUND", async () => {
    mockResolve4.mockRejectedValueOnce(dnsErr("ENOTFOUND", "nx v4"));
    mockResolve6.mockRejectedValueOnce(dnsErr("ENOTFOUND", "nx v6"));
    const err = await resolveHostnamePublic("nx-real.example").catch((e) => e);
    expect(err).toBeInstanceOf(DnsRebindingError);
  });

  it("throws DnsRebindingError when one family is ENODATA and the other returns no records", async () => {
    mockResolve4.mockRejectedValueOnce(dnsErr("ENODATA", "nodata v4"));
    mockResolve6.mockResolvedValueOnce([]);
    const err = await resolveHostnamePublic("nodata.example").catch((e) => e);
    expect(err).toBeInstanceOf(DnsRebindingError);
  });

  it("transient v4 + permanent v6 still throws plain Error (transient wins)", async () => {
    // The retry loop must err on the side of retrying. If ANY family
    // hit a transient resolver issue we don't yet know whether the
    // destination genuinely doesn't exist.
    mockResolve4.mockRejectedValueOnce(dnsErr("ESERVFAIL", "v4 servfail"));
    mockResolve6.mockRejectedValueOnce(dnsErr("ENOTFOUND", "v6 nx"));
    const err = await resolveHostnamePublic("mixed.example").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DnsRebindingError);
  });
});

describe("fetchHardened: happy path", () => {
  it("returns the response when no redirect", async () => {
    fetchSpy.mockResolvedValue(makeRes(200));
    const r = await fetchHardened("https://example.com/", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.ok).toBe(true);
    expect(r.redirectChain).toEqual(["https://example.com/"]);
    expect(mockValidateOutboundUrl).toHaveBeenCalledTimes(1);
  });
});

describe("fetchHardened: redirects", () => {
  it("follows up to MAX_REDIRECTS=3 hops and re-validates each", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeRes(302, { location: "https://hop1.example/" }))
      .mockResolvedValueOnce(makeRes(302, { location: "https://hop2.example/" }))
      .mockResolvedValueOnce(makeRes(302, { location: "https://hop3.example/" }))
      .mockResolvedValueOnce(makeRes(200));

    const r = await fetchHardened("https://start.example/", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.redirectChain).toEqual([
      "https://start.example/",
      "https://hop1.example/",
      "https://hop2.example/",
      "https://hop3.example/",
    ]);
    // Validated once per hop.
    expect(mockValidateOutboundUrl).toHaveBeenCalledTimes(4);
  });

  it("rejects when MAX_REDIRECTS is exceeded (4th hop)", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeRes(302, { location: "https://h1.example/" }))
      .mockResolvedValueOnce(makeRes(302, { location: "https://h2.example/" }))
      .mockResolvedValueOnce(makeRes(302, { location: "https://h3.example/" }))
      .mockResolvedValueOnce(makeRes(302, { location: "https://h4.example/" }));

    await expect(
      fetchHardened("https://start.example/", { method: "POST" }),
    ).rejects.toBeInstanceOf(WebhookRedirectError);
  });

  it("rejects protocol downgrade (https -> http)", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes(302, { location: "http://hop1.example/" }),
    );

    await expect(
      fetchHardened("https://start.example/", { method: "POST" }),
    ).rejects.toThrow(/protocol downgrade/i);
  });

  it("re-applies SSRF policy on each redirect hop", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes(302, { location: "https://attacker.example/" }),
    );
    mockValidateOutboundUrl
      .mockResolvedValueOnce(undefined) // start.example is fine
      .mockRejectedValueOnce(new Error("private IP")); // attacker.example fails

    await expect(
      fetchHardened("https://start.example/", { method: "POST" }),
    ).rejects.toThrow(/private IP/);
  });

  it("rejects when a redirect is missing the Location header", async () => {
    fetchSpy.mockResolvedValueOnce(makeRes(302));

    await expect(
      fetchHardened("https://start.example/", { method: "POST" }),
    ).rejects.toThrow(/without Location/);
  });

  it("re-resolves DNS on each redirect hop (rebinding defence)", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeRes(302, { location: "https://hop1.example/" }),
      )
      .mockResolvedValueOnce(makeRes(200));

    await fetchHardened("https://start.example/", { method: "POST" });
    // start.example + hop1.example = 2 DNS resolutions.
    expect(mockResolve4).toHaveBeenCalledTimes(2);
  });
});
