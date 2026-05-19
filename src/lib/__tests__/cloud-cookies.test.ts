import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  cloudCookieConfig,
  expireLegacyAuthCookies,
  _legacyAuthCookieNames,
} from "../cloud-cookies";

const ORIGINAL = process.env.VF_STRICT_MULTI_TENANT;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VF_STRICT_MULTI_TENANT;
  else process.env.VF_STRICT_MULTI_TENANT = ORIGINAL;
});

describe("cloudCookieConfig", () => {
  beforeEach(() => {
    delete process.env.VF_STRICT_MULTI_TENANT;
  });

  it("returns undefined under OSS / dev profile (no override)", () => {
    expect(cloudCookieConfig()).toBeUndefined();
  });

  it("returns undefined for typo'd env values (defence against accidental enablement)", () => {
    for (const v of ["1", "yes", "TRUE", "True", "false"]) {
      process.env.VF_STRICT_MULTI_TENANT = v;
      expect(cloudCookieConfig()).toBeUndefined();
    }
  });

  it("returns the __Host- override when VF_STRICT_MULTI_TENANT=true", () => {
    process.env.VF_STRICT_MULTI_TENANT = "true";
    const cfg = cloudCookieConfig();
    expect(cfg).toBeDefined();
  });

  it("every cookie name carries the __Host- prefix", () => {
    process.env.VF_STRICT_MULTI_TENANT = "true";
    const cfg = cloudCookieConfig();
    expect(cfg).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    for (const [, def] of Object.entries(cfg!)) {
      expect((def as { name?: string }).name).toMatch(/^__Host-vf-/);
    }
  });

  it("every cookie uses Secure + HttpOnly + Path=/ and NO Domain (host-only)", () => {
    process.env.VF_STRICT_MULTI_TENANT = "true";
    const cfg = cloudCookieConfig();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    for (const [, def] of Object.entries(cfg!)) {
      const opts = (def as { options?: Record<string, unknown> }).options ?? {};
      expect(opts.secure).toBe(true);
      expect(opts.httpOnly).toBe(true);
      expect(opts.path).toBe("/");
      expect(opts.sameSite).toBe("lax");
      // CRITICAL: no `domain` field — host-only is the whole point.
      expect(opts.domain).toBeUndefined();
    }
  });

  it("ephemeral cookies (pkceCodeVerifier, state) carry a maxAge cap", () => {
    process.env.VF_STRICT_MULTI_TENANT = "true";
    const cfg = cloudCookieConfig();
    expect(cfg).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const c = cfg!;
    for (const key of ["pkceCodeVerifier", "state"] as const) {
      const def = (c as Record<string, { options?: { maxAge?: number } }>)[
        key
      ];
      expect(def?.options?.maxAge).toBe(900);
    }
  });

  it("includes the cookies NextAuth needs for sign-in (sessionToken, callbackUrl, csrfToken)", () => {
    process.env.VF_STRICT_MULTI_TENANT = "true";
    const cfg = cloudCookieConfig();
    expect(cfg).toBeDefined();
    const keys = Object.keys(cfg as object);
    expect(keys).toContain("sessionToken");
    expect(keys).toContain("callbackUrl");
    expect(keys).toContain("csrfToken");
  });
});


function makeRequest(present: string[]) {
  return {
    cookies: { getAll: () => present.map((name) => ({ name })) },
  };
}
function makeResponse() {
  const set = vi.fn();
  return { cookies: { set }, _set: set };
}

describe("expireLegacyAuthCookies", () => {
  beforeEach(() => {
    delete process.env.VF_STRICT_MULTI_TENANT;
  });

  it("is a no-op when VF_STRICT_MULTI_TENANT is unset (OSS profile)", () => {
    const req = makeRequest(["next-auth.session-token", "authjs.session-token"]);
    const res = makeResponse();
    const expired = expireLegacyAuthCookies(req, res);
    expect(expired).toBe(0);
    expect(res._set).not.toHaveBeenCalled();
  });

  it("is a no-op when no legacy cookies are present", () => {
    process.env.VF_STRICT_MULTI_TENANT = "true";
    const req = makeRequest(["__Host-vf-session", "__Host-vf-csrf"]);
    const res = makeResponse();
    const expired = expireLegacyAuthCookies(req, res);
    expect(expired).toBe(0);
    expect(res._set).not.toHaveBeenCalled();
  });

  it("evicts every legacy next-auth.* cookie present with Max-Age=0", () => {
    process.env.VF_STRICT_MULTI_TENANT = "true";
    const legacy = ["next-auth.session-token", "__Secure-next-auth.callback-url"];
    const req = makeRequest([...legacy, "__Host-vf-session"]);
    const res = makeResponse();
    const expired = expireLegacyAuthCookies(req, res);
    expect(expired).toBe(legacy.length);
    expect(res._set).toHaveBeenCalledTimes(legacy.length);
    for (const call of res._set.mock.calls) {
      const opts = call[0] as Record<string, unknown>;
      expect(opts.value).toBe("");
      expect(opts.maxAge).toBe(0);
      expect(opts.path).toBe("/");
      expect(opts.httpOnly).toBe(true);
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe("lax");
      expect(legacy).toContain(opts.name);
    }
  });

  it("evicts legacy authjs.* cookies as well as next-auth.*", () => {
    process.env.VF_STRICT_MULTI_TENANT = "true";
    const legacy = [
      "authjs.session-token",
      "__Secure-authjs.session-token",
      "__Host-authjs.csrf-token",
    ];
    const req = makeRequest(legacy);
    const res = makeResponse();
    const expired = expireLegacyAuthCookies(req, res);
    expect(expired).toBe(legacy.length);
  });

  it("never evicts the modern __Host-vf-* cookies", () => {
    process.env.VF_STRICT_MULTI_TENANT = "true";
    const req = makeRequest([
      "__Host-vf-session",
      "__Host-vf-callback-url",
      "__Host-vf-csrf",
    ]);
    const res = makeResponse();
    expireLegacyAuthCookies(req, res);
    expect(res._set).not.toHaveBeenCalled();
  });

  it("legacy cookie list covers session, callback, csrf, pkce, state for both families", () => {
    const names = new Set<string>(_legacyAuthCookieNames);
    for (const family of ["next-auth", "authjs"]) {
      for (const piece of ["session-token", "callback-url", "csrf-token", "pkce.code_verifier", "state"]) {
        expect(names.has(`${family}.${piece}`)).toBe(true);
      }
    }
  });
});
