import type { KmsKeyDescriptor, KmsProvider } from "./types";

export interface VaultTransitConfig {
  address: string;
  token?: string;
  roleId?: string;
  secretId?: string;
  keyName: string;
  transitMount: string;
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
 * value, providing the AAD-style isolation the rest of the system
 * expects.
 *
 * Auth: a static `token` (dev), or AppRole `roleId` + `secretId`
 * (production).
 *
 * For Vault setup see the Cloud operations runbook; OSS users typically
 * either enable Transit on their existing Vault or fall back to
 * `local-dev` for non-production.
 */
export class VaultTransitKmsProvider implements KmsProvider {
  private clientToken: string | null = null;

  constructor(private readonly cfg: VaultTransitConfig) {
    if (!cfg.token && !(cfg.roleId && cfg.secretId)) {
      throw new Error(
        "VaultTransitKmsProvider requires either token or roleId+secretId",
      );
    }
  }

  private async token(): Promise<string> {
    if (this.cfg.token) return this.cfg.token;
    if (this.clientToken) return this.clientToken;
    if (!this.cfg.roleId || !this.cfg.secretId) {
      throw new Error("VaultTransitKmsProvider: AppRole credentials missing");
    }
    const url = `${this.cfg.address}/v1/auth/approle/login`;
    const res = await fetch(url, {
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
    const token = await this.token();
    const res = await fetch(`${this.cfg.address}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vault-token": token,
      },
      body: JSON.stringify(body),
    });
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
}
