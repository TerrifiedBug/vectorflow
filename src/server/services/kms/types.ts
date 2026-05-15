/**
 * KMS provider abstraction for VectorFlow envelope encryption.
 *
 * Architecture:
 *   - Each Organization holds a `dataKeyCiphertext` — a KMS-wrapped DEK.
 *   - On request, the app unwraps the DEK via this provider, derives
 *     domain-scoped keys with HKDF, and AES-256-GCM encrypts the row
 *     with per-row AAD that binds the ciphertext to (org, domain, table, rowId).
 *
 * OSS providers shipped here:
 *   - `LocalDevKmsProvider` — wraps with a master KEK derived from
 *     `VF_LOCAL_KMS_KEY` (or `NEXTAUTH_SECRET`). Dev/test only.
 *   - `VaultTransitKmsProvider` — calls Vault Transit `encrypt`/`decrypt`
 *     for production self-hosted users.
 *
 * Closed providers (cloud/ workspace):
 *   - `AwsKmsProvider` — AWS KMS `GenerateDataKey` / `Decrypt`. Cloud only.
 */

export type KmsProviderKind = "local-dev" | "vault-transit" | "aws-kms";

export interface KmsKeyDescriptor {
  /** Which provider is fronting the wrapping key. */
  provider: KmsProviderKind;
  /** Human-readable identifier for the wrapping key (for logs and audit). */
  keyId: string;
}

export interface KmsProvider {
  /**
   * Generate a fresh 32-byte plaintext DEK and return it alongside the
   * provider-wrapped ciphertext that the caller must persist.
   *
   * The wrapped ciphertext MUST be bound to `orgId` so that a ciphertext
   * stolen from org A cannot be unwrapped under org B.
   */
  generateDataKey(orgId: string): Promise<{ plaintext: Buffer; ciphertext: string }>;

  /**
   * Unwrap a previously-wrapped DEK. The caller MUST provide the same
   * `orgId` used at wrap time; mismatched orgs MUST throw.
   *
   * `grantToken` is an opaque token issued by a break-glass workflow that
   * temporarily grants decryption rights to an operator session. Providers
   * that do not implement break-glass ignore the parameter.
   */
  unwrapDataKey(ciphertext: string, orgId: string, grantToken?: string): Promise<Buffer>;

  /**
   * Re-wrap an existing plaintext DEK under the provider's current
   * wrapping key. Used during KEK rotation: existing ciphertexts can be
   * re-wrapped without changing any row-level v3 ciphertexts.
   */
  rewrapDataKey(plaintext: Buffer, orgId: string): Promise<string>;

  /**
   * Schedule the org's wrapping key for deletion. After the provider's
   * cool-down window passes, the org's data is cryptographically erased.
   * Optional: not every provider supports this (e.g. local-dev is a no-op).
   */
  scheduleKeyDeletion?(orgId: string): Promise<void>;

  /** Identification for audit/logs. */
  describeKey(): KmsKeyDescriptor;
}
