import { describe, it, expect, beforeEach } from "vitest";
import { LocalDevKmsProvider } from "../local-dev";
import { VaultTransitKmsProvider } from "../vault-transit";

describe("KmsProvider.healthCheck — real round-trip", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "health-check-test-secret-not-prod";
    delete process.env.VF_LOCAL_KMS_KEY;
  });

  describe("LocalDevKmsProvider", () => {
    it("returns ok with a fresh round-trip identifier", async () => {
      const kms = new LocalDevKmsProvider();
      const r = await kms.healthCheck();
      expect(r.ok).toBe(true);
      expect(typeof r.keyId).toBe("string");
      expect(r.keyId?.length ?? 0).toBeGreaterThan(0);
    });

    it("reports unhealthy when KEK material is unavailable", async () => {
      delete process.env.NEXTAUTH_SECRET;
      delete process.env.VF_LOCAL_KMS_KEY;
      const kms = new LocalDevKmsProvider();
      const r = await kms.healthCheck();
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/requires.+(NEXTAUTH_SECRET|VF_LOCAL_KMS_KEY)/i);
    });
  });

  describe("VaultTransitKmsProvider", () => {
    function fakeVaultThatResponds(handler: (path: string) => Response) {
      return new VaultTransitKmsProvider({
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
            return new Response(
              JSON.stringify({ auth: { client_token: "tok" } }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return handler(url);
        },
      });
    }

    it("performs a real network round-trip to Vault and reports ok on 200", async () => {
      let probed = false;
      const provider = fakeVaultThatResponds((path) => {
        if (path.endsWith("/v1/transit/keys/vectorflow-kek")) {
          probed = true;
          return new Response(JSON.stringify({ data: { name: "vectorflow-kek" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not implemented", { status: 501 });
      });
      const r = await provider.healthCheck();
      expect(probed).toBe(true);
      expect(r.ok).toBe(true);
    });

    it("reports unhealthy when Vault returns 5xx", async () => {
      const provider = fakeVaultThatResponds(
        () => new Response("backend down", { status: 503 }),
      );
      const r = await provider.healthCheck();
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/503/);
    });

    it("reports unhealthy when Vault network probe throws", async () => {
      const provider = new VaultTransitKmsProvider({
        address: "https://vault.example",
        roleId: "r",
        secretId: "s",
        keyName: "vectorflow-kek",
        transitMount: "transit",
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      });
      const r = await provider.healthCheck();
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/ECONNREFUSED/);
    });
  });
});
