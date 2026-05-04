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

    expect(
      isDevAuthBypassRequestAllowed(
        new Request("http://localhost:3000/api/auth/session", {
          headers: { "x-forwarded-for": "127.0.0.1" },
        }),
        env,
      ),
    ).toBe(true);
    expect(isDevAuthBypassRequestAllowed(new Request("http://localhost:3000/api/auth/session"), env)).toBe(false);
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

    expect(
      isDevAuthBypassRequestAllowed(
        new Request("http://localhost:3000/api/auth/session", {
          headers: { host: "localhost:3000" },
        }),
        env,
      ),
    ).toBe(false);
  });
});
