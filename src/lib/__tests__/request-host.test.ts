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
  it("returns false when neither env var is true", () => {
    expect(
      trustsForwardedHost({
        VF_TRUST_FORWARDED_HOST: "false",
        VF_TRUST_PROXY_HEADERS: undefined,
      }),
    ).toBe(false);
  });

  it("returns true when VF_TRUST_FORWARDED_HOST=true", () => {
    expect(
      trustsForwardedHost({
        VF_TRUST_FORWARDED_HOST: "true",
        VF_TRUST_PROXY_HEADERS: undefined,
      }),
    ).toBe(true);
  });

  it("returns true when VF_TRUST_PROXY_HEADERS=true (legacy alias)", () => {
    expect(
      trustsForwardedHost({
        VF_TRUST_FORWARDED_HOST: undefined,
        VF_TRUST_PROXY_HEADERS: "true",
      }),
    ).toBe(true);
  });

  it("only treats the literal string \"true\" as truthy", () => {
    expect(
      trustsForwardedHost({
        VF_TRUST_FORWARDED_HOST: "1",
        VF_TRUST_PROXY_HEADERS: "yes",
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
        VF_TRUST_PROXY_HEADERS: undefined,
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
        VF_TRUST_PROXY_HEADERS: undefined,
      }),
    ).toBe("acme.vectorflow.sh");
  });

  it("returns X-Forwarded-Host when VF_TRUST_PROXY_HEADERS=true", () => {
    const headers = makeHeaders({
      host: "internal.cluster.local:3000",
      "x-forwarded-host": "acme.vectorflow.sh",
    });
    expect(
      getRequestHostFromHeaders(headers, {
        VF_TRUST_FORWARDED_HOST: undefined,
        VF_TRUST_PROXY_HEADERS: "true",
      }),
    ).toBe("acme.vectorflow.sh");
  });

  it("falls back to Host when proxy is trusted but X-Forwarded-Host is missing", () => {
    const headers = makeHeaders({ host: "cloud.localtest.me:3000" });
    expect(
      getRequestHostFromHeaders(headers, {
        VF_TRUST_FORWARDED_HOST: "true",
        VF_TRUST_PROXY_HEADERS: undefined,
      }),
    ).toBe("cloud.localtest.me:3000");
  });

  it("returns null when neither Host nor X-Forwarded-Host is present", () => {
    expect(
      getRequestHostFromHeaders(makeHeaders({}), {
        VF_TRUST_FORWARDED_HOST: "true",
        VF_TRUST_PROXY_HEADERS: undefined,
      }),
    ).toBeNull();
  });
});
