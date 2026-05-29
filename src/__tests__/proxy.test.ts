import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { proxy, resolveSessionCookieName } from "@/proxy";

// Set by vitest.config.ts `test.env`. hasValidSession() reads the same var.
const SECRET = process.env.NEXTAUTH_SECRET!;

function getProxyMatcherSource() {
  const source = readFileSync(resolve(process.cwd(), "src/proxy.ts"), "utf8");
  const match = source.match(/matcher:\s*\[\s*"([^"]+)"/);

  expect(match?.[1]).toBeTypeOf("string");
  return match![1];
}

function matchesProxy(pathname: string) {
  return new RegExp(`^${getProxyMatcherSource()}$`).test(pathname);
}

describe("proxy matcher", () => {
  it("does not guard tRPC, Next.js dev assets, font endpoints, or backup APIs", () => {
    expect(matchesProxy("/api/trpc/pipeline.list")).toBe(false);
    expect(matchesProxy("/_next/webpack-hmr")).toBe(false);
    expect(matchesProxy("/__nextjs_font/inter.css")).toBe(false);
    expect(matchesProxy("/api/backups/upload")).toBe(false);
  });
});

describe("resolveSessionCookieName", () => {
  it("picks the __Secure- name when the HTTPS session cookie is present", () => {
    expect(resolveSessionCookieName(["__Secure-authjs.session-token"])).toBe(
      "__Secure-authjs.session-token",
    );
  });

  it("picks the bare name over HTTP", () => {
    expect(resolveSessionCookieName(["authjs.session-token"])).toBe(
      "authjs.session-token",
    );
  });

  it("resolves chunked secure cookies by base name", () => {
    expect(
      resolveSessionCookieName([
        "__Secure-authjs.session-token.0",
        "__Secure-authjs.session-token.1",
      ]),
    ).toBe("__Secure-authjs.session-token");
  });

  it("prefers the secure name when both prefixes are present", () => {
    expect(
      resolveSessionCookieName([
        "authjs.session-token",
        "__Secure-authjs.session-token",
      ]),
    ).toBe("__Secure-authjs.session-token");
  });

  it("returns undefined when no session cookie is present", () => {
    expect(resolveSessionCookieName(["csrf", "other"])).toBeUndefined();
  });

  it("honours an explicit strict-mode override verbatim", () => {
    expect(
      resolveSessionCookieName(["authjs.session-token"], "__Host-vf-session"),
    ).toBe("__Host-vf-session");
  });
});

describe("proxy auth gate (OSS / non-strict)", () => {
  // Mirror exactly how @auth/core sets the session cookie: the JWE salt is
  // the cookie name. Over HTTPS that name is `__Secure-authjs.session-token`.
  async function signedSessionRequest(url: string, cookieName: string) {
    const jwt = await encode({
      token: { id: "user-1", org_id: "default" },
      secret: SECRET,
      salt: cookieName,
    });
    return new NextRequest(url, {
      headers: { cookie: `${cookieName}=${jwt}` },
    });
  }

  it("admits a request carrying the HTTPS __Secure- session cookie (redirect-loop regression)", async () => {
    const req = await signedSessionRequest(
      "https://app.example.com/dashboard",
      "__Secure-authjs.session-token",
    );
    const res = await proxy(req);

    // Authenticated → pass through. Before the fix getToken looked for the
    // bare `authjs.session-token`, missed the `__Secure-` cookie, and 307'd
    // back to /login on every request — the reported loop.
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("admits a request carrying the HTTP bare session cookie", async () => {
    const req = await signedSessionRequest(
      "http://localhost:3000/dashboard",
      "authjs.session-token",
    );
    const res = await proxy(req);

    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("redirects unauthenticated requests to /login", async () => {
    const req = new NextRequest("https://app.example.com/dashboard");
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
