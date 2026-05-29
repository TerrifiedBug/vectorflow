import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Cloud / strict-multi-tenant profile: Auth.js is configured with an explicit
// `__Host-vf-session` cookie (see src/lib/strict-cookies.ts). This profile must
// keep working unchanged after the OSS redirect-loop fix — the proxy resolves
// the session cookie via the explicit override and never falls through to the
// `authjs.session-token` sniffing used for OSS.
//
// VF_STRICT_MULTI_TENANT is read at module-init time (authConfig.cookies), so we
// stub it and re-import the proxy inside beforeAll.

const SECRET = process.env.NEXTAUTH_SECRET!;
const HOST_COOKIE = "__Host-vf-session";

describe("proxy auth gate — strict multi-tenant (Cloud)", () => {
  let proxy: typeof import("@/proxy").proxy;
  let resolveSessionCookieName: typeof import("@/proxy").resolveSessionCookieName;
  let NextRequest: typeof import("next/server").NextRequest;
  let encode: typeof import("next-auth/jwt").encode;

  beforeAll(async () => {
    vi.stubEnv("VF_STRICT_MULTI_TENANT", "true");
    vi.resetModules();
    // Re-import from the reset registry so authConfig.cookies picks up strict mode.
    ({ NextRequest } = await import("next/server"));
    ({ encode } = await import("next-auth/jwt"));
    const mod = await import("@/proxy");
    proxy = mod.proxy;
    resolveSessionCookieName = mod.resolveSessionCookieName;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the __Host-vf-session override even when authjs cookies are present", () => {
    expect(
      resolveSessionCookieName([
        "authjs.session-token",
        "__Secure-authjs.session-token",
      ]),
    ).toBe(HOST_COOKIE);
  });

  it("admits a request carrying the __Host-vf-session cookie", async () => {
    const jwt = await encode({
      token: { id: "user-1", org_id: "default" },
      secret: SECRET,
      salt: HOST_COOKIE,
    });
    const req = new NextRequest("https://acme.vectorflow.sh/dashboard", {
      headers: { cookie: `${HOST_COOKIE}=${jwt}` },
    });
    const res = await proxy(req);

    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("redirects to /login when the __Host-vf-session cookie is absent", async () => {
    const req = new NextRequest("https://acme.vectorflow.sh/dashboard");
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
