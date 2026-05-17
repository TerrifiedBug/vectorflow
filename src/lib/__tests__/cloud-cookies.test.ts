import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { cloudCookieConfig } from "../cloud-cookies";

const ORIGINAL = process.env.VF_CLOUD_BUILD;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VF_CLOUD_BUILD;
  else process.env.VF_CLOUD_BUILD = ORIGINAL;
});

describe("cloudCookieConfig", () => {
  beforeEach(() => {
    delete process.env.VF_CLOUD_BUILD;
  });

  it("returns undefined under OSS / dev profile (no override)", () => {
    expect(cloudCookieConfig()).toBeUndefined();
  });

  it("returns undefined for typo'd env values (defence against accidental enablement)", () => {
    for (const v of ["1", "yes", "TRUE", "True", "false"]) {
      process.env.VF_CLOUD_BUILD = v;
      expect(cloudCookieConfig()).toBeUndefined();
    }
  });

  it("returns the __Host- override when VF_CLOUD_BUILD=true", () => {
    process.env.VF_CLOUD_BUILD = "true";
    const cfg = cloudCookieConfig();
    expect(cfg).toBeDefined();
  });

  it("every cookie name carries the __Host- prefix", () => {
    process.env.VF_CLOUD_BUILD = "true";
    const cfg = cloudCookieConfig();
    expect(cfg).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    for (const [, def] of Object.entries(cfg!)) {
      expect((def as { name?: string }).name).toMatch(/^__Host-vf-/);
    }
  });

  it("every cookie uses Secure + HttpOnly + Path=/ and NO Domain (host-only)", () => {
    process.env.VF_CLOUD_BUILD = "true";
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
    process.env.VF_CLOUD_BUILD = "true";
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
    process.env.VF_CLOUD_BUILD = "true";
    const cfg = cloudCookieConfig();
    expect(cfg).toBeDefined();
    const keys = Object.keys(cfg as object);
    expect(keys).toContain("sessionToken");
    expect(keys).toContain("callbackUrl");
    expect(keys).toContain("csrfToken");
  });
});
