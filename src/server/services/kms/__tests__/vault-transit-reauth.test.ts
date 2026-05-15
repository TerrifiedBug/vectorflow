import { describe, it, expect } from "vitest";
import { VaultTransitKmsProvider } from "../vault-transit";

/**
 * Tests for Codex P1: Vault AppRole token expiry must trigger re-auth.
 *
 * We drive the provider with an injected `fetch`-shaped function. The
 * fake Vault tracks token validity per call, returns 403 on expired
 * tokens, and accepts a fresh AppRole login.
 */
function fakeVault(opts: { expireAfter: number }): {
  fetchImpl: typeof fetch;
  metrics: { logins: number; failedDecrypts: number; successfulDecrypts: number };
} {
  let currentToken: string | null = null;
  let callsSinceLogin = 0;
  const metrics = { logins: 0, failedDecrypts: 0, successfulDecrypts: 0 };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    // AppRole login
    if (url.endsWith("/v1/auth/approle/login")) {
      metrics.logins++;
      callsSinceLogin = 0;
      currentToken = `tok-${metrics.logins}`;
      return new Response(
        JSON.stringify({ auth: { client_token: currentToken } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const headers = init?.headers as Record<string, string> | undefined;
    const presented = headers?.["x-vault-token"];
    if (!presented || presented !== currentToken) {
      // Vault returns 403 for invalid/expired tokens
      metrics.failedDecrypts++;
      return new Response("permission denied", { status: 403 });
    }
    // Token presented is current, but may have expired by call count
    if (callsSinceLogin >= opts.expireAfter) {
      currentToken = null;
      metrics.failedDecrypts++;
      return new Response("token expired", { status: 403 });
    }
    callsSinceLogin++;

    if (url.includes("/decrypt/")) {
      metrics.successfulDecrypts++;
      return new Response(
        JSON.stringify({ data: { plaintext: Buffer.alloc(32, 7).toString("base64") } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not implemented", { status: 501 });
  };

  return { fetchImpl, metrics };
}

describe("VaultTransitKmsProvider — AppRole re-auth (Codex P1)", () => {
  it("logs in once, then continues serving while the token is valid", async () => {
    const { fetchImpl, metrics } = fakeVault({ expireAfter: 5 });
    const provider = new VaultTransitKmsProvider({
      address: "https://vault.example",
      roleId: "r",
      secretId: "s",
      keyName: "k",
      transitMount: "transit",
      fetchImpl,
    });
    for (let i = 0; i < 3; i++) {
      await provider.unwrapDataKey("vault:v1:abc", "org-a");
    }
    expect(metrics.logins).toBe(1);
    expect(metrics.successfulDecrypts).toBe(3);
  });

  it("re-logs in once after token expiry and retries the failed request", async () => {
    const { fetchImpl, metrics } = fakeVault({ expireAfter: 2 });
    const provider = new VaultTransitKmsProvider({
      address: "https://vault.example",
      roleId: "r",
      secretId: "s",
      keyName: "k",
      transitMount: "transit",
      fetchImpl,
    });

    // 3 unwraps; token expires after 2 → the third triggers re-auth + retry
    for (let i = 0; i < 3; i++) {
      await provider.unwrapDataKey("vault:v1:abc", "org-a");
    }
    expect(metrics.successfulDecrypts).toBe(3); // every operation succeeded eventually
    expect(metrics.logins).toBe(2); // initial + one re-auth
  });

  it("surfaces a hard error when re-auth itself fails repeatedly", async () => {
    let loginCount = 0;
    const provider = new VaultTransitKmsProvider({
      address: "https://vault.example",
      roleId: "r",
      secretId: "s",
      keyName: "k",
      transitMount: "transit",
      fetchImpl: async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/login")) {
          loginCount++;
          return new Response("forbidden", { status: 403 });
        }
        return new Response("forbidden", { status: 403 });
      },
    });
    await expect(provider.unwrapDataKey("v:abc", "org-a")).rejects.toThrow();
    // We attempt login at most once per request and bail.
    expect(loginCount).toBeLessThanOrEqual(2);
  });
});
