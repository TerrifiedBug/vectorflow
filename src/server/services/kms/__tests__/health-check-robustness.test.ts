import { describe, it, expect } from "vitest";
import { VaultTransitKmsProvider } from "../vault-transit";

describe("VaultTransitKmsProvider.healthCheck — robustness", () => {
  function makeFakeVault(
    onCall: (url: string, attempt: number) => Response,
  ): {
    provider: VaultTransitKmsProvider;
    metrics: { logins: number; healthAttempts: number };
  } {
    const metrics = { logins: 0, healthAttempts: 0 };
    let validToken: string | null = null;
    const provider = new VaultTransitKmsProvider({
      address: "https://vault.example",
      roleId: "r",
      secretId: "s",
      keyName: "vectorflow-kek",
      transitMount: "transit",
      fetchImpl: async (input) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith("/v1/auth/approle/login")) {
          metrics.logins++;
          validToken = `tok-${metrics.logins}`;
          return new Response(
            JSON.stringify({ auth: { client_token: validToken } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        metrics.healthAttempts++;
        return onCall(url, metrics.healthAttempts);
      },
    });
    return { provider, metrics };
  }

  it("re-authenticates and retries when the first health probe returns 401", async () => {
    const { provider, metrics } = makeFakeVault((_url, attempt) => {
      if (attempt === 1) return new Response("expired", { status: 401 });
      return new Response(JSON.stringify({ data: { name: "vectorflow-kek" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const r = await provider.healthCheck();
    expect(r.ok).toBe(true);
    expect(metrics.logins).toBe(2); // initial + re-auth
    expect(metrics.healthAttempts).toBe(2);
  });

  it("re-authenticates and retries on a 403", async () => {
    const { provider, metrics } = makeFakeVault((_url, attempt) => {
      if (attempt === 1) return new Response("forbidden", { status: 403 });
      return new Response(JSON.stringify({ data: { name: "vectorflow-kek" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const r = await provider.healthCheck();
    expect(r.ok).toBe(true);
    expect(metrics.logins).toBe(2);
  });

  it("does not retry indefinitely — gives up after one re-auth attempt", async () => {
    const { provider, metrics } = makeFakeVault(() =>
      new Response("still forbidden", { status: 403 }),
    );
    const r = await provider.healthCheck();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/403/);
    // 1 initial attempt + 1 retry after re-auth = 2 health attempts max.
    expect(metrics.healthAttempts).toBeLessThanOrEqual(2);
  });
});
