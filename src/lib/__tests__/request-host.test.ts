import { describe, expect, it } from "vitest";

import {
  getRequestHostFromHeaders,
  trustsForwardedHost,
} from "../request-host";

function makeHeaders(init: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(init)) h.set(k, v);
  return h;
}

describe("trustsForwardedHost", () => {
  it("returns false when VF_TRUST_FORWARDED_HOST is unset / not 'true'", () => {
    expect(
      trustsForwardedHost({
        VF_TRUST_FORWARDED_HOST: undefined,
        VF_TRUST_PROXY_HEADERS: undefined,
      }),
    ).toBe(false);
    expect(
      trustsForwardedHost({
        VF_TRUST_FORWARDED_HOST: "false",
      }),
    ).toBe(false);
  });

  it("returns true when VF_TRUST_FORWARDED_HOST=true", () => {
    expect(
      trustsForwardedHost({
        VF_TRUST_FORWARDED_HOST: "true",
      }),
    ).toBe(true);
  });

  it("does NOT honour VF_TRUST_PROXY_HEADERS for host trust (Codex P1)", () => {
    // VF_TRUST_PROXY_HEADERS governs forwarded-client-IP trust only.
    // Conflating it with host trust silently widened the attack surface
    // for any deployment that had set it for client-IP attribution
    // without auditing host handling.
    expect(
      trustsForwardedHost({
        VF_TRUST_FORWARDED_HOST: undefined,
        VF_TRUST_PROXY_HEADERS: "true",
      }),
    ).toBe(false);
  });

  it('only treats the literal string "true" as truthy', () => {
    expect(
      trustsForwardedHost({
        VF_TRUST_FORWARDED_HOST: "1",
      }),
    ).toBe(false);
    expect(
      trustsForwardedHost({
        VF_TRUST_FORWARDED_HOST: "yes",
      }),
    ).toBe(false);
  });
});

describe("getRequestHostFromHeaders", () => {
  it("returns the Host header when proxy is not trusted", () => {
    const headers = makeHeaders({
      host: "cloud.localtest.me:3000",
      "x-forwarded-host": "attacker.example.com",
    });
    expect(
      getRequestHostFromHeaders(headers, {
        VF_TRUST_FORWARDED_HOST: undefined,
      }),
    ).toBe("cloud.localtest.me:3000");
  });

  it("returns X-Forwarded-Host when VF_TRUST_FORWARDED_HOST=true", () => {
    const headers = makeHeaders({
      host: "internal.cluster.local:3000",
      "x-forwarded-host": "acme.vectorflow.sh",
    });
    expect(
      getRequestHostFromHeaders(headers, {
        VF_TRUST_FORWARDED_HOST: "true",
      }),
    ).toBe("acme.vectorflow.sh");
  });

  it("ignores X-Forwarded-Host when only VF_TRUST_PROXY_HEADERS=true (Codex P1)", () => {
    const headers = makeHeaders({
      host: "internal.cluster.local:3000",
      "x-forwarded-host": "spoof.attacker.com",
    });
    expect(
      getRequestHostFromHeaders(headers, {
        VF_TRUST_FORWARDED_HOST: undefined,
        VF_TRUST_PROXY_HEADERS: "true",
      }),
    ).toBe("internal.cluster.local:3000");
  });

  it("takes only the FIRST hop of multi-value X-Forwarded-Host (Codex P1)", () => {
    // RFC 7239: proxies append left-to-right, so the client-facing
    // host is the leftmost entry. Without splitting, downstream
    // callers build URLs with the raw `"tenant.example.com, edge.internal"`
    // value and the link is malformed.
    const headers = makeHeaders({
      host: "internal.cluster.local",
      "x-forwarded-host": "acme.vectorflow.sh, edge.internal",
    });
    expect(
      getRequestHostFromHeaders(headers, {
        VF_TRUST_FORWARDED_HOST: "true",
      }),
    ).toBe("acme.vectorflow.sh");
  });

  it("trims whitespace between hops in X-Forwarded-Host", () => {
    const headers = makeHeaders({
      host: "internal.cluster.local",
      "x-forwarded-host": "  acme.vectorflow.sh  ,  edge.internal  ",
    });
    expect(
      getRequestHostFromHeaders(headers, {
        VF_TRUST_FORWARDED_HOST: "true",
      }),
    ).toBe("acme.vectorflow.sh");
  });

  it("falls back to Host when proxy is trusted but X-Forwarded-Host is missing", () => {
    const headers = makeHeaders({ host: "cloud.localtest.me:3000" });
    expect(
      getRequestHostFromHeaders(headers, {
        VF_TRUST_FORWARDED_HOST: "true",
      }),
    ).toBe("cloud.localtest.me:3000");
  });

  it("falls back to Host when X-Forwarded-Host is set but the first hop is empty", () => {
    const headers = makeHeaders({
      host: "cloud.localtest.me:3000",
      "x-forwarded-host": "  ",
    });
    expect(
      getRequestHostFromHeaders(headers, {
        VF_TRUST_FORWARDED_HOST: "true",
      }),
    ).toBe("cloud.localtest.me:3000");
  });

  it("returns null when neither Host nor X-Forwarded-Host is present", () => {
    expect(
      getRequestHostFromHeaders(makeHeaders({}), {
        VF_TRUST_FORWARDED_HOST: "true",
      }),
    ).toBeNull();
  });
});
