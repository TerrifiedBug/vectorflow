/**
 * AwsKmsProvider — wraps DEKs via AWS KMS.
 *
 * Implements the OSS `KmsProvider` interface from
 * `@/server/services/kms/types`. Lives in the cloud/ workspace because
 * AWS-specific code MUST NOT contaminate the AGPL OSS surface (plan §15a).
 *
 * Wrap/unwrap path:
 *
 *   - `generateDataKey(orgId)`:
 *       KMS.GenerateDataKey({
 *         KeyId,
 *         KeySpec: "AES_256",
 *         EncryptionContext: { orgId, purpose: "data-encryption-key" },
 *       })
 *     -> returns 32-byte plaintext + opaque base64 ciphertext.
 *
 *   - `unwrapDataKey(ciphertext, orgId, grantToken?)`:
 *       KMS.Decrypt({
 *         CiphertextBlob,
 *         EncryptionContext: { orgId, ... },
 *         GrantTokens: grantToken ? [grantToken] : undefined,
 *       })
 *     -> AWS rejects on EC mismatch (cross-tenant replay defeated at the
 *        KMS layer, not just in our app code).
 *
 *   - `rewrapDataKey(plaintext, orgId)`:
 *       KMS.GenerateDataKey + KMS.Encrypt-style flow. Equivalent to
 *       generateDataKey but re-uses the supplied plaintext so downstream
 *       v3 row ciphertexts stay valid (KEK rotation; DEK unchanged).
 *
 *   - `scheduleKeyDeletion(orgId)`:
 *       KMS.ScheduleKeyDeletion({ KeyId, PendingWindowInDays: 7 }).
 *       Cryptographic-erase tail of the tenant lifecycle (plan §12).
 *
 *   - `healthCheck()`: KMS.DescribeKey on the configured CMK. Used by
 *     /api/health/cloud to detect outages before they hit hot paths.
 *
 * Configuration:
 *
 *   - `keyId`: the CMK ARN (or alias/...) the provider wraps DEKs with.
 *     For the shared-CMK model, every org gets a DEK wrapped by the
 *     same regional CMK; the EncryptionContext (orgId) is what binds
 *     the ciphertext to the tenant.
 *   - For BYOK (plan §4 ENTERPRISE-tier flow), each org has its own
 *     CMK ARN stored on `Organization.byokKeyArn`. The Cloud signup
 *     handler constructs a per-org AwsKmsProvider with that ARN.
 *
 * AWS SDK logger is silenced so plaintext DEK material never appears
 * in CloudWatch via verbose-mode logging.
 *
 * Plaintext zeroing: `generateDataKey` returns the plaintext Buffer to
 * the caller. The DekCache `invalidate` path overwrites the buffer
 * with zeros on eviction; this provider does not retain a reference
 * after returning.
 */

import { Buffer } from "node:buffer";

import type {
  KmsHealthResult,
  KmsKeyDescriptor,
  KmsProvider,
} from "@/server/services/kms/types";

export interface AwsKmsConfig {
  /** AWS region (`us-east-1`, `eu-west-1`, ...). */
  region: string;
  /**
   * The CMK to wrap DEKs with. Either the ARN or an alias (`alias/vf-cloud`).
   * For BYOK orgs, the per-org CMK ARN on `Organization.byokKeyArn`.
   */
  keyId: string;
  /**
   * Optional override for the AWS SDK client (tests inject a stub).
   * Defaults to a lazily-constructed `KMSClient` from `@aws-sdk/client-kms`.
   */
  client?: AwsKmsClientLike;
  /**
   * Bundle name visible in audit logs / health output (`prod-eu-1`).
   */
  bundleLabel?: string;
}

/**
 * Subset of the `@aws-sdk/client-kms` surface this provider depends on.
 * Defined here so tests can inject a fake without bringing the AWS SDK
 * dependency into the test runner.
 */
export interface AwsKmsClientLike {
  generateDataKey(args: {
    KeyId: string;
    KeySpec: "AES_256";
    EncryptionContext: Record<string, string>;
  }): Promise<{ Plaintext?: Uint8Array; CiphertextBlob?: Uint8Array }>;
  decrypt(args: {
    CiphertextBlob: Uint8Array;
    EncryptionContext?: Record<string, string>;
    GrantTokens?: string[];
  }): Promise<{ Plaintext?: Uint8Array }>;
  encrypt(args: {
    KeyId: string;
    Plaintext: Uint8Array;
    EncryptionContext: Record<string, string>;
  }): Promise<{ CiphertextBlob?: Uint8Array }>;
  scheduleKeyDeletion(args: {
    KeyId: string;
    PendingWindowInDays: number;
  }): Promise<unknown>;
  describeKey(args: { KeyId: string }): Promise<{
    KeyMetadata?: { KeyId?: string; Enabled?: boolean };
  }>;
}

const ENC_CONTEXT_PURPOSE = "data-encryption-key";
const DEFAULT_PENDING_DELETION_DAYS = 7;

export class AwsKmsProvider implements KmsProvider {
  private readonly client: AwsKmsClientLike;
  private readonly keyId: string;
  private readonly bundleLabel: string;

  constructor(cfg: AwsKmsConfig) {
    if (!cfg.region) throw new Error("AwsKmsProvider: region is required");
    if (!cfg.keyId) throw new Error("AwsKmsProvider: keyId is required");
    this.keyId = cfg.keyId;
    this.bundleLabel = cfg.bundleLabel ?? cfg.region;
    this.client = cfg.client ?? buildDefaultClient(cfg.region);
  }

  async generateDataKey(
    orgId: string,
  ): Promise<{ plaintext: Buffer; ciphertext: string }> {
    if (!orgId) {
      throw new Error("AwsKmsProvider.generateDataKey: orgId required");
    }
    const res = await this.client.generateDataKey({
      KeyId: this.keyId,
      KeySpec: "AES_256",
      EncryptionContext: encryptionContextFor(orgId),
    });
    if (!res.Plaintext || !res.CiphertextBlob) {
      throw new Error(
        "AwsKmsProvider.generateDataKey: empty Plaintext/CiphertextBlob in response",
      );
    }
    return {
      plaintext: Buffer.from(res.Plaintext),
      ciphertext: bufferToB64(res.CiphertextBlob),
    };
  }

  async unwrapDataKey(
    ciphertext: string,
    orgId: string,
    grantToken?: string,
  ): Promise<Buffer> {
    if (!orgId) {
      throw new Error("AwsKmsProvider.unwrapDataKey: orgId required");
    }
    const res = await this.client.decrypt({
      CiphertextBlob: b64ToBuffer(ciphertext),
      EncryptionContext: encryptionContextFor(orgId),
      GrantTokens: grantToken ? [grantToken] : undefined,
    });
    if (!res.Plaintext) {
      throw new Error(
        "AwsKmsProvider.unwrapDataKey: empty Plaintext in response",
      );
    }
    return Buffer.from(res.Plaintext);
  }

  async rewrapDataKey(plaintext: Buffer, orgId: string): Promise<string> {
    if (!orgId) {
      throw new Error("AwsKmsProvider.rewrapDataKey: orgId required");
    }
    if (plaintext.length !== 32) {
      throw new Error(
        `AwsKmsProvider.rewrapDataKey: expected 32-byte plaintext, got ${plaintext.length}`,
      );
    }
    const res = await this.client.encrypt({
      KeyId: this.keyId,
      Plaintext: new Uint8Array(plaintext),
      EncryptionContext: encryptionContextFor(orgId),
    });
    if (!res.CiphertextBlob) {
      throw new Error(
        "AwsKmsProvider.rewrapDataKey: empty CiphertextBlob in response",
      );
    }
    return bufferToB64(res.CiphertextBlob);
  }

  async scheduleKeyDeletion(orgId: string): Promise<void> {
    if (!orgId) {
      throw new Error("AwsKmsProvider.scheduleKeyDeletion: orgId required");
    }
    // For the shared-CMK model, we do NOT delete the shared key here —
    // the per-org wrap is invalidated when the customer's data is
    // dropped (the wrapped DEK ciphertext on Organization.dataKeyCiphertext
    // is what gets purged). This method is meaningful only for BYOK
    // orgs where the caller passes the per-org CMK ARN as `orgId` is
    // not used; here we use the configured keyId as the target.
    //
    // The Cloud tenant-lifecycle hard-delete cron decides which
    // provider instance to call; that instance owns the right keyId.
    await this.client.scheduleKeyDeletion({
      KeyId: this.keyId,
      PendingWindowInDays: DEFAULT_PENDING_DELETION_DAYS,
    });
  }

  describeKey(): KmsKeyDescriptor {
    return {
      provider: "aws-kms",
      keyId: `${this.bundleLabel}:${redactKeyArn(this.keyId)}`,
    };
  }

  async healthCheck(opts?: { signal?: AbortSignal }): Promise<KmsHealthResult> {
    // Honour the abort signal so a probe that the caller has already
    // given up on does not leak a hanging HTTPS request.
    if (opts?.signal?.aborted) {
      return { ok: false, error: "aborted before describeKey" };
    }
    try {
      const res = await this.client.describeKey({ KeyId: this.keyId });
      if (res.KeyMetadata?.Enabled === false) {
        return {
          ok: false,
          keyId: res.KeyMetadata.KeyId,
          error: "CMK is disabled",
        };
      }
      return {
        ok: true,
        keyId: res.KeyMetadata?.KeyId ?? this.keyId,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "describeKey failed",
      };
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function encryptionContextFor(orgId: string): Record<string, string> {
  return { orgId, purpose: ENC_CONTEXT_PURPOSE };
}

function bufferToB64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

function b64ToBuffer(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function redactKeyArn(arn: string): string {
  // CMK ARNs end in `key/<uuid>`. We keep the prefix (region + account)
  // and replace the uuid with first-8 + ellipsis so logs are diagnostic
  // without exposing the full key id.
  const idx = arn.lastIndexOf("/");
  if (idx === -1 || idx === arn.length - 1) return arn;
  const head = arn.slice(0, idx + 1);
  const tail = arn.slice(idx + 1);
  if (tail.length <= 12) return arn;
  return `${head}${tail.slice(0, 8)}…`;
}

/**
 * Default client factory — constructs an `@aws-sdk/client-kms` KMSClient
 * lazily so the SDK is only loaded when the AWS provider is actually
 * used (Cloud) and never in OSS / dev / Vault deployments.
 *
 * Lazy via dynamic import inside a captured-promise closure so the
 * first call seeds the client, subsequent calls reuse it.
 */
function buildDefaultClient(region: string): AwsKmsClientLike {
  let inner: Promise<AwsKmsClientLike> | null = null;

  async function getInner(): Promise<AwsKmsClientLike> {
    if (!inner) {
      inner = (async () => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — optional peer dep; cloud workspace installs it
        const mod = await import("@aws-sdk/client-kms");
        const KMSClient = (mod as {
          KMSClient: new (cfg: { region: string; logger?: { info(): void; debug(): void; warn(): void; error(): void } }) => unknown;
        }).KMSClient;
        const Send = (mod as {
          GenerateDataKeyCommand: new (i: unknown) => unknown;
          DecryptCommand: new (i: unknown) => unknown;
          EncryptCommand: new (i: unknown) => unknown;
          ScheduleKeyDeletionCommand: new (i: unknown) => unknown;
          DescribeKeyCommand: new (i: unknown) => unknown;
        });
        const silentLogger = {
          info() {},
          debug() {},
          warn() {},
          error() {},
        };
        const client = new KMSClient({ region, logger: silentLogger }) as {
          send(cmd: unknown): Promise<unknown>;
        };
        // Adapter: present a stable shape regardless of SDK command class.
        return {
          async generateDataKey(args) {
            const cmd = new Send.GenerateDataKeyCommand(args);
            return (await client.send(cmd)) as {
              Plaintext?: Uint8Array;
              CiphertextBlob?: Uint8Array;
            };
          },
          async decrypt(args) {
            const cmd = new Send.DecryptCommand(args);
            return (await client.send(cmd)) as { Plaintext?: Uint8Array };
          },
          async encrypt(args) {
            const cmd = new Send.EncryptCommand(args);
            return (await client.send(cmd)) as { CiphertextBlob?: Uint8Array };
          },
          async scheduleKeyDeletion(args) {
            const cmd = new Send.ScheduleKeyDeletionCommand(args);
            return client.send(cmd);
          },
          async describeKey(args) {
            const cmd = new Send.DescribeKeyCommand(args);
            return (await client.send(cmd)) as {
              KeyMetadata?: { KeyId?: string; Enabled?: boolean };
            };
          },
        } satisfies AwsKmsClientLike;
      })();
    }
    return inner;
  }

  return {
    async generateDataKey(args) {
      return (await getInner()).generateDataKey(args);
    },
    async decrypt(args) {
      return (await getInner()).decrypt(args);
    },
    async encrypt(args) {
      return (await getInner()).encrypt(args);
    },
    async scheduleKeyDeletion(args) {
      return (await getInner()).scheduleKeyDeletion(args);
    },
    async describeKey(args) {
      return (await getInner()).describeKey(args);
    },
  };
}
