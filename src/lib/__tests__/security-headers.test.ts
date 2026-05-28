import { describe, it, expect, afterEach } from "vitest";
import {
  contentSecurityPolicy,
  isStrictMultiTenantMode,
  securityHeaders,
} from "../security-headers";

describe("contentSecurityPolicy", () => {
  it("OSS default: keeps 'unsafe-eval' and 'unsafe-inline' in script-src", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toMatch(/script-src 'self' 'unsafe-eval' 'unsafe-inline'/);
  });

  it("Strict multi-tenant mode (with nonce): removes 'unsafe-eval' and 'unsafe-inline' from script-src", () => {
    const csp = contentSecurityPolicy("abc123nonceXYZ==");
    expect(csp).not.toMatch(/'unsafe-eval'/);
    const scriptDirective = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));
    expect(scriptDirective).toBeDefined();
    expect(scriptDirective).not.toMatch(/'unsafe-inline'/);
    expect(scriptDirective).not.toMatch(/'unsafe-eval'/);
  });

  it("Strict multi-tenant mode (with nonce): removes 'unsafe-inline' from style-src and uses nonce", () => {
    const csp = contentSecurityPolicy("abc123nonceXYZ==");
    const styleDirective = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("style-src"));
    expect(styleDirective).toBeDefined();
    expect(styleDirective).not.toMatch(/'unsafe-inline'/);
    expect(styleDirective).toMatch(/'nonce-abc123nonceXYZ=='/);
  });

  it("OSS default: keeps 'unsafe-inline' in style-src", () => {
    const csp = contentSecurityPolicy();
    const styleDirective = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("style-src"));
    expect(styleDirective).toBeDefined();
    expect(styleDirective).toMatch(/'unsafe-inline'/);
  });

  it("Strict multi-tenant mode: embeds the supplied nonce + 'strict-dynamic'", () => {
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

describe("isStrictMultiTenantMode", () => {
  const ORIGINAL = process.env.VF_STRICT_MULTI_TENANT;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.VF_STRICT_MULTI_TENANT;
    else process.env.VF_STRICT_MULTI_TENANT = ORIGINAL;
  });

  it("false when VF_STRICT_MULTI_TENANT is unset", () => {
    delete process.env.VF_STRICT_MULTI_TENANT;
    expect(isStrictMultiTenantMode()).toBe(false);
  });

  it("true when VF_STRICT_MULTI_TENANT === 'true'", () => {
    process.env.VF_STRICT_MULTI_TENANT = "true";
    expect(isStrictMultiTenantMode()).toBe(true);
  });

  it("false for any other value (defence against typos enabling strict mode by accident)", () => {
    for (const v of ["1", "yes", "TRUE", "false", ""]) {
      process.env.VF_STRICT_MULTI_TENANT = v;
      expect(isStrictMultiTenantMode()).toBe(false);
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
    // The static CSP is the default permissive variant; strict multi-tenant
    // middleware swaps it per-request when VF_STRICT_MULTI_TENANT=true.
    expect(csp).toMatch(/script-src 'self' 'unsafe-eval' 'unsafe-inline'/);
  });
});
