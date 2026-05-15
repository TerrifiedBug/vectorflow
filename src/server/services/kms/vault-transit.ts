import type { KmsHealthResult, KmsKeyDescriptor, KmsProvider } from "./types";

export interface VaultTransitConfig {
  address: string;
  token?: string;
  roleId?: string;
  secretId?: string;
  keyName: string;
  transitMount: string;
  /** Injection seam for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface VaultDataKeyResponse {
  data?: {
    plaintext?: string;
    ciphertext?: string;
  };
}

interface VaultDecryptResponse {
  data?: { plaintext?: string };
}

interface VaultEncryptResponse {
  data?: { ciphertext?: string };
}

interface VaultAuthResponse {
  auth?: { client_token?: string };
}

/**
 * VaultTransitKmsProvider — wraps DEKs via Vault Transit's
 * `datakey/plaintext`, `encrypt`, and `decrypt` endpoints.
 *
 * The Vault Transit `context` parameter binds wrap/unwrap to a per-org
 * value, providing the AAD-style isolation the rest of the system expects.
 *
 * Auth: a static `token` (dev), or AppRole `roleId` + `secretId`
 * (production). AppRole client tokens are time-limited; on a 401/403
 * response the provider invalidates the cached token, re-authenticates,
 * and retries the original request once. Static tokens never trigger
 * re-auth because the user owns rotation in that mode.
 */
export class VaultTransitKmsProvider implements KmsProvider {
  private clientToken: string | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: VaultTransitConfig) {
    if (!cfg.token && !(cfg.roleId && cfg.secretId)) {
      throw new Error(
        "VaultTransitKmsProvider requires either token or roleId+secretId",
      );
    }
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  /** True when running under AppRole (re-auth is possible). */
  private get canReauth(): boolean {
    return !this.cfg.token && Boolean(this.cfg.roleId && this.cfg.secretId);
  }

  private async getToken(forceRefresh = false): Promise<string> {
    if (this.cfg.token) return this.cfg.token;
    if (this.clientToken && !forceRefresh) return this.clientToken;
    if (!this.cfg.roleId || !this.cfg.secretId) {
      throw new Error("VaultTransitKmsProvider: AppRole credentials missing");
    }
    const url = `${this.cfg.address}/v1/auth/approle/login`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role_id: this.cfg.roleId,
        secret_id: this.cfg.secretId,
      }),
    });
    if (!res.ok) {
      throw new Error(`vault-transit: AppRole login failed (${res.status})`);
    }
    const body = (await res.json()) as VaultAuthResponse;
    const token = body.auth?.client_token;
    if (!token) throw new Error("vault-transit: AppRole login missing token");
    this.clientToken = token;
    return token;
  }

  private context(orgId: string): string {
    return Buffer.from(`vectorflow:org:${orgId}`, "utf8").toString("base64");
  }

  private async vaultFetch(
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const doFetch = async (token: string) =>
      this.fetchImpl(`${this.cfg.address}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vault-token": token,
        },
        body: JSON.stringify(body),
      });

    let token = await this.getToken();
    let res = await doFetch(token);

    // AppRole token expiry surfaces as 401/403. Invalidate the cached
    // token and retry the request once with a freshly-acquired token.
    if ((res.status === 401 || res.status === 403) && this.canReauth) {
      this.clientToken = null;
      token = await this.getToken(true);
      res = await doFetch(token);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vault-transit: ${path} failed (${res.status}) ${text.slice(0, 200)}`,
      );
    }
    return res.json();
  }

  async generateDataKey(
    orgId: string,
  ): Promise<{ plaintext: Buffer; ciphertext: string }> {
    const data = (await this.vaultFetch(
      `/v1/${this.cfg.transitMount}/datakey/plaintext/${this.cfg.keyName}`,
      { context: this.context(orgId), bits: 256 },
    )) as VaultDataKeyResponse;
    const plaintextB64 = data.data?.plaintext;
    const ciphertext = data.data?.ciphertext;
    if (!plaintextB64 || !ciphertext) {
      throw new Error("vault-transit: datakey response missing fields");
    }
    return {
      plaintext: Buffer.from(plaintextB64, "base64"),
      ciphertext,
    };
  }

  async unwrapDataKey(ciphertext: string, orgId: string): Promise<Buffer> {
    const data = (await this.vaultFetch(
      `/v1/${this.cfg.transitMount}/decrypt/${this.cfg.keyName}`,
      { context: this.context(orgId), ciphertext },
    )) as VaultDecryptResponse;
    const plaintextB64 = data.data?.plaintext;
    if (!plaintextB64) {
      throw new Error("vault-transit: decrypt response missing plaintext");
    }
    return Buffer.from(plaintextB64, "base64");
  }

  async rewrapDataKey(plaintext: Buffer, orgId: string): Promise<string> {
    if (plaintext.length !== 32) {
      throw new Error("vault-transit: plaintext DEK must be 32 bytes");
    }
    const data = (await this.vaultFetch(
      `/v1/${this.cfg.transitMount}/encrypt/${this.cfg.keyName}`,
      {
        context: this.context(orgId),
        plaintext: plaintext.toString("base64"),
      },
    )) as VaultEncryptResponse;
    const ciphertext = data.data?.ciphertext;
    if (!ciphertext) {
      throw new Error("vault-transit: encrypt response missing ciphertext");
    }
    return ciphertext;
  }

  describeKey(): KmsKeyDescriptor {
    return {
      provider: "vault-transit",
      keyId: `vault-transit:${this.cfg.transitMount}/${this.cfg.keyName}`,
    };
  }

  async healthCheck(): Promise<KmsHealthResult> {
    // GET /v1/<mount>/keys/<name> hits the same Vault path the encrypt and
    // decrypt ops will use, so a failure here is a true indicator of an
    // upcoming hot-path failure. The probe goes through the same 401/403
    // re-auth path `vaultFetch` uses for the cryptographic operations so
    // an expired AppRole token does not produce a permanent false-unhealthy.
    const url = `${this.cfg.address}/v1/${this.cfg.transitMount}/keys/${this.cfg.keyName}`;
    const doGet = (tok: string) =>
      this.fetchImpl(url, {
        method: "GET",
        headers: { "x-vault-token": tok },
      });
    try {
      let token = await this.getToken();
      let res = await doGet(token);
      if ((res.status === 401 || res.status === 403) && this.canReauth) {
        this.clientToken = null;
        token = await this.getToken(true);
        res = await doGet(token);
      }
      if (!res.ok) {
        return {
          ok: false,
          error: `vault-transit healthCheck: HTTP ${res.status}`,
        };
      }
      return { ok: true, keyId: this.describeKey().keyId };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
