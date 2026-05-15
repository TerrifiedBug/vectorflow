import { describe, it, expect } from "vitest";
import {
  securityHeaders,
  contentSecurityPolicy,
} from "../security-headers";

describe("securityHeaders", () => {
  const headers = securityHeaders();
  const byKey = new Map(headers.map((h) => [h.key, h.value]));

  it("sets Cross-Origin-Opener-Policy to same-origin (multi-tenant subdomain isolation, plan §8)", () => {
    expect(byKey.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("sets Cross-Origin-Resource-Policy to same-origin", () => {
    expect(byKey.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });

  it("sets X-Frame-Options DENY (in addition to frame-ancestors 'none' in CSP)", () => {
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets X-Content-Type-Options nosniff", () => {
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets Referrer-Policy strict-origin-when-cross-origin", () => {
    expect(byKey.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("sets Permissions-Policy denying camera/microphone/geolocation", () => {
    const p = byKey.get("Permissions-Policy") ?? "";
    expect(p).toContain("camera=()");
    expect(p).toContain("microphone=()");
    expect(p).toContain("geolocation=()");
  });

  it("emits a Content-Security-Policy header sourced from contentSecurityPolicy()", () => {
    expect(byKey.get("Content-Security-Policy")).toBe(contentSecurityPolicy());
  });
});

describe("contentSecurityPolicy", () => {
  const csp = contentSecurityPolicy();

  it("denies framing via frame-ancestors 'none'", () => {
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("denies object embeds (object-src 'none')", () => {
    expect(csp).toContain("object-src 'none'");
  });

  it("locks base-uri to 'self' (prevents <base> hijacks)", () => {
    expect(csp).toContain("base-uri 'self'");
  });

  it("scopes connect-src to self + Sentry only", () => {
    const directive = csp
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("connect-src"));
    expect(directive).toBeDefined();
    expect(directive).toContain("'self'");
    expect(directive).toContain("*.sentry.io");
  });
});
