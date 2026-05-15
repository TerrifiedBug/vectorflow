import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import type { KmsHealthResult, KmsKeyDescriptor, KmsProvider } from "./types";

const PREFIX = "lk1:";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEK_INFO = "vf:local-kms:kek:v1";

/**
 * LocalDevKmsProvider — wraps DEKs with a master KEK derived from
 * `VF_LOCAL_KMS_KEY` (or `NEXTAUTH_SECRET` as fallback).
 *
 * **NOT FOR PRODUCTION.** Provides the same surface as a real KMS so that
 * OSS development and CI can exercise the envelope-encryption code path
 * without a Vault/AWS dependency.
 *
 * Wire format: `lk1:<base64(iv || tag || ciphertext)>`
 * AAD: `local-kms:org=<orgId>`.
 */
export class LocalDevKmsProvider implements KmsProvider {
  private kek(): Buffer {
    const master =
      process.env.VF_LOCAL_KMS_KEY ?? process.env.NEXTAUTH_SECRET;
    if (!master) {
      throw new Error(
        "LocalDevKmsProvider requires VF_LOCAL_KMS_KEY or NEXTAUTH_SECRET",
      );
    }
    const ikm = Buffer.from(master, "utf8");
    return Buffer.from(
      hkdfSync("sha256", ikm, Buffer.alloc(0), Buffer.from(KEK_INFO, "utf8"), 32),
    );
  }

  private aad(orgId: string): Buffer {
    return Buffer.from(`local-kms:org=${orgId}`, "utf8");
  }

  async generateDataKey(
    orgId: string,
  ): Promise<{ plaintext: Buffer; ciphertext: string }> {
    const plaintext = randomBytes(32);
    const ciphertext = await this.rewrapDataKey(plaintext, orgId);
    return { plaintext, ciphertext };
  }

  async unwrapDataKey(ciphertext: string, orgId: string): Promise<Buffer> {
    if (!ciphertext.startsWith(PREFIX)) {
      throw new Error(`local-kms: ciphertext missing prefix "${PREFIX}"`);
    }
    const payload = Buffer.from(ciphertext.slice(PREFIX.length), "base64");
    if (payload.length < IV_LEN + TAG_LEN) {
      throw new Error("local-kms: ciphertext too short");
    }
    const iv = payload.subarray(0, IV_LEN);
    const tag = payload.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = payload.subarray(IV_LEN + TAG_LEN);
    const kek = this.kek();
    try {
      const decipher = createDecipheriv("aes-256-gcm", kek, iv);
      decipher.setAAD(this.aad(orgId));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    } finally {
      kek.fill(0);
    }
  }

  async rewrapDataKey(plaintext: Buffer, orgId: string): Promise<string> {
    if (plaintext.length !== 32) {
      throw new Error("local-kms: plaintext DEK must be 32 bytes");
    }
    const iv = randomBytes(IV_LEN);
    const kek = this.kek();
    try {
      const cipher = createCipheriv("aes-256-gcm", kek, iv);
      cipher.setAAD(this.aad(orgId));
      const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
    } finally {
      kek.fill(0);
    }
  }

  describeKey(): KmsKeyDescriptor {
    // KeyId is a hash of the KEK — useful in audit, not reversible.
    const kek = this.kek();
    try {
      const fingerprint = createHash("sha256").update(kek).digest("hex").slice(0, 16);
      return { provider: "local-dev", keyId: `local-dev:${fingerprint}` };
    } finally {
      kek.fill(0);
    }
  }

  async healthCheck(): Promise<KmsHealthResult> {
    try {
      // LocalDev has no remote dependency. The "round trip" is verifying
      // that the KEK material is available; this catches misconfigured
      // environments where NEXTAUTH_SECRET / VF_LOCAL_KMS_KEY are unset.
      const desc = this.describeKey();
      return { ok: true, keyId: desc.keyId };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
