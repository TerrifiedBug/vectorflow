import { describe, expect, it } from "vitest";
import {
  getDevAuthBypassSession,
  isDevAuthBypassEnabled,
  isDevAuthBypassEnabledForRequest,
  isDevAuthBypassRequestAllowed,
} from "../dev-auth-bypass";

describe("dev auth bypass", () => {
  it("stays disabled unless explicitly enabled", () => {
    expect(isDevAuthBypassEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isDevAuthBypassEnabled({ NODE_ENV: "development", DEV_AUTH_BYPASS: "0" })).toBe(false);
  });

  it("returns the seeded QA user session when enabled outside production", () => {
    const session = getDevAuthBypassSession(
      {
        NODE_ENV: "development",
        DEV_AUTH_BYPASS: "1",
        DEV_AUTH_BYPASS_USER_ID: "qa-user-id",
        DEV_AUTH_BYPASS_USER_EMAIL: "qa@example.test",
        DEV_AUTH_BYPASS_USER_NAME: "QA User",
      },
      { requestHost: "localhost:3000", clientAddress: "127.0.0.1" },
    );

    expect(session?.user).toEqual({
      id: "qa-user-id",
      email: "qa@example.test",
      name: "QA User",
      image: null,
    });
  });

  it("only allows localhost requests unless network bypass is explicitly enabled", () => {
    const env = {
      NODE_ENV: "development",
      DEV_AUTH_BYPASS: "1",
    };

    expect(isDevAuthBypassRequestAllowed(new Request("http://localhost:3000/api/auth/session"), env)).toBe(true);
    expect(
      isDevAuthBypassRequestAllowed(
        new Request("http://localhost:3000/api/auth/session", {
          headers: { "x-forwarded-for": "127.0.0.1" },
        }),
        env,
      ),
    ).toBe(false);
    expect(isDevAuthBypassRequestAllowed(new Request("http://192.168.1.50:3000/api/auth/session"), env)).toBe(
      false,
    );
    expect(
      isDevAuthBypassRequestAllowed(
        new Request("http://localhost:3000/api/auth/session", {
          headers: { "x-forwarded-for": "203.0.113.10" },
        }),
        env,
      ),
    ).toBe(false);
    expect(isDevAuthBypassEnabledForRequest(env, { requestHost: "localhost:3000" })).toBe(false);
    expect(
      isDevAuthBypassEnabledForRequest(env, {
        requestHost: "localhost:3000",
        clientAddress: "127.0.0.1",
      }),
    ).toBe(true);
    expect(
      isDevAuthBypassRequestAllowed(new Request("http://192.168.1.50:3000/api/auth/session"), {
        ...env,
        DEV_AUTH_BYPASS_ALLOW_NETWORK: "1",
      }),
    ).toBe(true);
  });

  it("does not return a bypass session for remote requests by default", () => {
    const session = getDevAuthBypassSession(
      {
        NODE_ENV: "development",
        DEV_AUTH_BYPASS: "1",
      },
      new Request("http://192.168.1.50:3000/api/auth/session"),
    );

    expect(session).toBeNull();
  });

  it("refuses to run in production", () => {
    expect(() =>
      isDevAuthBypassEnabled({ NODE_ENV: "production", DEV_AUTH_BYPASS: "1" }),
    ).toThrow("DEV_AUTH_BYPASS cannot be enabled when NODE_ENV=production");
  });

  it("does not enable the bypass for non-local request hosts by default", () => {
    const env = { NODE_ENV: "development", DEV_AUTH_BYPASS: "1" };

    expect(isDevAuthBypassEnabledForRequest(env, { requestHost: "example.com" })).toBe(false);
    expect(getDevAuthBypassSession(env, { requestHost: "example.com" })).toBeNull();
  });

  it("allows non-local request hosts only with the network exposure opt-in", () => {
    const env = {
      NODE_ENV: "development",
      DEV_AUTH_BYPASS: "1",
      DEV_AUTH_BYPASS_ALLOW_NETWORK: "1",
    };

    expect(isDevAuthBypassEnabledForRequest(env, { requestHost: "qa-tunnel.example.com" })).toBe(true);
    expect(getDevAuthBypassSession(env, { requestHost: "qa-tunnel.example.com" })?.user.email).toBe(
      "qa@vectorflow.local",
    );
  });

  it("does not enable the bypass when the client address is missing", () => {
    const env = { NODE_ENV: "development", DEV_AUTH_BYPASS: "1" };

    expect(isDevAuthBypassEnabledForRequest(env, { requestHost: "localhost:3000" })).toBe(false);
  });

  it("rejects spoofable proxy headers unless trusted proxy headers are explicitly enabled", () => {
    const env = { NODE_ENV: "development", DEV_AUTH_BYPASS: "1" };

    expect(
      isDevAuthBypassRequestAllowed(
        new Request("http://localhost:3000/api/auth/session", {
          headers: {
            "x-forwarded-for": "127.0.0.1",
            "x-forwarded-host": "localhost:3000",
          },
        }),
        env,
      ),
    ).toBe(false);

    expect(
      isDevAuthBypassRequestAllowed(
        new Request("http://localhost:3000/api/auth/session", {
          headers: { "x-forwarded-for": "127.0.0.1" },
        }),
        { ...env, VF_TRUST_PROXY_HEADERS: "true" },
      ),
    ).toBe(true);
  });

  // These tests document the cases that trigger a 403 in the auth handler:
  // DEV_AUTH_BYPASS=1 is set, but the request originates from a non-local client.
  // The handler must not fall through to NextAuth — it must actively reject.
  describe("403 guard: non-local requests are denied when bypass is enabled", () => {
    const env = { NODE_ENV: "development", DEV_AUTH_BYPASS: "1" };

    it("blocks a request from a LAN IP (bypass enabled but not localhost)", () => {
      expect(
        isDevAuthBypassEnabled(env),
      ).toBe(true);

      expect(
        isDevAuthBypassRequestAllowed(
          new Request("http://192.168.1.100:3000/api/auth/session"),
          env,
        ),
      ).toBe(false);
    });

    it("blocks a request from a public IP even with a localhost Host header", () => {
      // A client behind a reverse proxy can set Host: localhost — the guard must
      // still deny because the origin IP is non-local.
      expect(
        isDevAuthBypassRequestAllowed(
          new Request("http://0.0.0.0:3000/api/auth/session", {
            headers: { "x-forwarded-for": "203.0.113.42" },
          }),
          env,
        ),
      ).toBe(false);
    });

    it("blocks when the server is bound to 0.0.0.0 and request host is non-local", () => {
      expect(
        isDevAuthBypassRequestAllowed(
          new Request("http://10.0.0.5:3000/api/auth/session"),
          env,
        ),
      ).toBe(false);
    });

    it("allows a genuine localhost request (::1 loopback)", () => {
      expect(
        isDevAuthBypassRequestAllowed(
          new Request("http://[::1]:3000/api/auth/session"),
          env,
        ),
      ).toBe(true);
    });
  });
});
