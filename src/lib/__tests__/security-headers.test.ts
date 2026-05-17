import { describe, it, expect, afterEach } from "vitest";
import {
  contentSecurityPolicy,
  isCloudBuildProfile,
  securityHeaders,
} from "../security-headers";

describe("contentSecurityPolicy", () => {
  it("OSS default: keeps 'unsafe-eval' and 'unsafe-inline' in script-src", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toMatch(/script-src 'self' 'unsafe-eval' 'unsafe-inline'/);
  });

  it("Cloud profile (with nonce): removes 'unsafe-eval' and 'unsafe-inline' from script-src", () => {
    const csp = contentSecurityPolicy("abc123nonceXYZ==");
    expect(csp).not.toMatch(/'unsafe-eval'/);
    // unsafe-inline should be gone from script-src but stays on
    // style-src (documented carve-out for Tailwind / shadcn).
    const scriptDirective = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));
    expect(scriptDirective).toBeDefined();
    expect(scriptDirective).not.toMatch(/'unsafe-inline'/);
    expect(scriptDirective).not.toMatch(/'unsafe-eval'/);
  });

  it("Cloud profile: embeds the supplied nonce + 'strict-dynamic'", () => {
    const csp = contentSecurityPolicy("nonceXYZ");
    expect(csp).toMatch(/script-src 'self' 'nonce-nonceXYZ' 'strict-dynamic'/);
  });

  it("base directives are stable across profiles", () => {
    for (const csp of [contentSecurityPolicy(), contentSecurityPolicy("n")]) {
      expect(csp).toMatch(/default-src 'self'/);
      expect(csp).toMatch(/img-src 'self' data: blob:/);
      expect(csp).toMatch(/connect-src 'self' \*\.sentry\.io/);
      expect(csp).toMatch(/frame-ancestors 'none'/);
      expect(csp).toMatch(/object-src 'none'/);
      expect(csp).toMatch(/base-uri 'self'/);
    }
  });
});

describe("isCloudBuildProfile", () => {
  const ORIGINAL = process.env.VF_CLOUD_BUILD;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.VF_CLOUD_BUILD;
    else process.env.VF_CLOUD_BUILD = ORIGINAL;
  });

  it("false when VF_CLOUD_BUILD is unset", () => {
    delete process.env.VF_CLOUD_BUILD;
    expect(isCloudBuildProfile()).toBe(false);
  });

  it("true when VF_CLOUD_BUILD === 'true'", () => {
    process.env.VF_CLOUD_BUILD = "true";
    expect(isCloudBuildProfile()).toBe(true);
  });

  it("false for any other value (defence against typos enabling strict mode by accident)", () => {
    for (const v of ["1", "yes", "TRUE", "false", ""]) {
      process.env.VF_CLOUD_BUILD = v;
      expect(isCloudBuildProfile()).toBe(false);
    }
  });
});

describe("securityHeaders", () => {
  it("includes the standard top-level headers", () => {
    const headers = securityHeaders();
    const byKey = Object.fromEntries(headers.map((h) => [h.key, h.value]));
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(byKey["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(byKey["Content-Security-Policy"]).toBeDefined();
  });

  it("Content-Security-Policy uses the no-nonce form (middleware overrides per-request)", () => {
    const csp = securityHeaders().find(
      (h) => h.key === "Content-Security-Policy",
    )?.value;
    expect(csp).toBeDefined();
    // The static CSP is the OSS-default permissive variant; the Cloud
    // middleware swaps it per-request when VF_CLOUD_BUILD=true.
    expect(csp).toMatch(/script-src 'self' 'unsafe-eval' 'unsafe-inline'/);
  });
});
