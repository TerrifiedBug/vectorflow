import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ENCRYPTION_DOMAINS } from "@/server/services/crypto";
import {
  encryptForOrgOrFallback,
  decryptForOrgOrFallback,
  loadOrgDataKeyCiphertext,
} from "@/server/services/crypto-v3-callsite";

/**
 * VectorFlow Lake — bring-your-own object-storage bucket for the cold tier (A5,
 * OSS part).
 *
 * By default the lake cold tier lives in a VectorFlow-managed S3 bucket. An
 * environment may instead point its cold tier at the customer's own bucket
 * (`EnvironmentLakeBucket`). The credentials are encrypted at rest with the
 * per-org crypto-v3 envelope (falling back to v2 for OSS / self-hosted orgs
 * with no DEK), mirroring `Secret.encryptedValue` / `Team.aiApiKey`.
 *
 * Searchability: ClickHouse can mount an S3 (or S3-compatible) bucket as an
 * external disk and serve in-place lake search over the cold tier. GCS and
 * Azure are not wired as ClickHouse external disks in this build, so a dataset
 * whose cold tier lives solely in such a bucket is cold-only — it is marked
 * `LakeDataset.tiering = 'external'` and in-place search is disabled for it.
 *
 * Cloud provisioning of the actual bucket access (IAM, bucket policy, the
 * ClickHouse disk wiring) is out of scope here — it lives in the cloud repo.
 * This module owns the OSS config surface: encrypt/decrypt, effective-target
 * resolution, and the catalog tiering reconciliation that drives the
 * degraded-search UX.
 */

/** Object-storage providers a BYO lake cold-tier bucket may target. */
export const LAKE_BUCKET_PROVIDERS = ["s3", "gcs", "azure"] as const;
export type LakeBucketProvider = (typeof LAKE_BUCKET_PROVIDERS)[number];

/**
 * Whether ClickHouse can read this provider's bucket as an external disk and
 * therefore serve in-place lake search over its cold tier. Only `s3` (incl.
 * S3-compatible endpoints) is wired as a ClickHouse `s3` disk here; `gcs` and
 * `azure` are cold-only archives → their datasets are marked `external`.
 */
export function coldTierIsSearchable(provider: LakeBucketProvider): boolean {
  return provider === "s3";
}

export interface BucketCryptoScope {
  /** The organization that owns the environment (RLS + AAD tenant). */
  orgId: string;
  /**
   * The environment whose bucket the credential belongs to. Doubles as the
   * stable AAD row id (it is unique on `EnvironmentLakeBucket` and never
   * changes), so encrypt and decrypt derive the same key without round-
   * tripping the Prisma-default cuid — same idea as `Secret`'s composite id.
   */
  environmentId: string;
}

/** Encrypt a single bucket credential at rest (crypto-v3 with v2 fallback). */
export async function encryptBucketCredential(
  plaintext: string,
  scope: BucketCryptoScope,
): Promise<string> {
  const dataKeyCiphertext = await loadOrgDataKeyCiphertext(scope.orgId);
  return encryptForOrgOrFallback(plaintext, {
    orgId: scope.orgId,
    dataKeyCiphertext,
    domain: ENCRYPTION_DOMAINS.GENERIC,
    rowTable: "EnvironmentLakeBucket",
    rowId: scope.environmentId,
  });
}

/**
 * Decrypt a bucket credential for privileged use (cold-tier config delivery).
 * Never call this on a read path that returns data to the client.
 */
export async function decryptBucketCredential(
  ciphertext: string,
  scope: BucketCryptoScope,
): Promise<string> {
  const dataKeyCiphertext = await loadOrgDataKeyCiphertext(scope.orgId);
  return decryptForOrgOrFallback(ciphertext, {
    orgId: scope.orgId,
    dataKeyCiphertext,
    domain: ENCRYPTION_DOMAINS.GENERIC,
    rowTable: "EnvironmentLakeBucket",
    rowId: scope.environmentId,
  });
}

/** Effective cold-tier destination for an environment. Never carries secrets. */
export type ColdTierTarget =
  | { kind: "vf-managed" }
  | {
      kind: "byo";
      provider: LakeBucketProvider;
      bucket: string;
      region: string | null;
      endpoint: string | null;
      prefix: string | null;
      /** ClickHouse can search this cold tier in place. */
      searchable: boolean;
      /** A static credential pair is stored (vs. instance/workload identity). */
      hasCredentials: boolean;
    };

/**
 * Resolve where an environment's lake cold tier physically lives — the
 * VF-managed bucket (default) or the customer's BYO bucket. Returns only the
 * non-secret descriptor plus credential presence; never decrypts.
 */
export async function resolveColdTierTarget(
  environmentId: string,
): Promise<ColdTierTarget> {
  const bucket = await prisma.environmentLakeBucket.findUnique({
    where: { environmentId },
  });
  if (!bucket) return { kind: "vf-managed" };
  const provider = bucket.provider as LakeBucketProvider;
  return {
    kind: "byo",
    provider,
    bucket: bucket.bucket,
    region: bucket.region,
    endpoint: bucket.endpoint,
    prefix: bucket.prefix,
    searchable: coldTierIsSearchable(provider),
    hasCredentials:
      !!bucket.encryptedAccessKeyId || !!bucket.encryptedSecretAccessKey,
  };
}

/**
 * Decrypted BYO bucket credentials for privileged cold-tier config delivery.
 * Returns `null` when the environment uses the VF-managed bucket, and `null`
 * fields when the bucket relies on instance/workload identity instead of a
 * static key pair.
 */
export async function resolveColdTierCredentials(
  environmentId: string,
): Promise<{ accessKeyId: string | null; secretAccessKey: string | null } | null> {
  const bucket = await prisma.environmentLakeBucket.findUnique({
    where: { environmentId },
    select: {
      organizationId: true,
      encryptedAccessKeyId: true,
      encryptedSecretAccessKey: true,
    },
  });
  if (!bucket) return null;
  const scope = { orgId: bucket.organizationId, environmentId };
  return {
    accessKeyId: bucket.encryptedAccessKeyId
      ? await decryptBucketCredential(bucket.encryptedAccessKeyId, scope)
      : null,
    secretAccessKey: bucket.encryptedSecretAccessKey
      ? await decryptBucketCredential(bucket.encryptedSecretAccessKey, scope)
      : null,
  };
}

/**
 * Reconcile `LakeDataset.tiering` for every dataset in an environment against
 * its current cold-tier target. A BYO bucket ClickHouse cannot search marks the
 * env's datasets `external` (cold-only — degraded search); a searchable cold
 * tier (VF-managed, or a BYO S3 disk) reverts previously-`external` datasets to
 * `cold`. Idempotent. Runs inside the caller's tenant transaction so it is
 * atomic with the bucket upsert/delete.
 */
export async function syncDatasetTieringForEnvironment(
  tx: Prisma.TransactionClient,
  args: { orgId: string; environmentId: string },
): Promise<{ searchable: boolean; updated: number }> {
  const bucket = await tx.environmentLakeBucket.findUnique({
    where: { environmentId: args.environmentId },
    select: { provider: true },
  });
  const searchable =
    !bucket || coldTierIsSearchable(bucket.provider as LakeBucketProvider);

  if (searchable) {
    // Cold tier is searchable again — recover any datasets we previously
    // demoted to external (e.g. after switching away from a gcs/azure bucket).
    const result = await tx.lakeDataset.updateMany({
      where: {
        organizationId: args.orgId,
        environmentId: args.environmentId,
        tiering: "external",
      },
      data: { tiering: "cold" },
    });
    return { searchable, updated: result.count };
  }

  // External-only cold tier — demote every searchable dataset to external so
  // the search UI shows the degraded-search notice.
  const result = await tx.lakeDataset.updateMany({
    where: {
      organizationId: args.orgId,
      environmentId: args.environmentId,
      tiering: { not: "external" },
    },
    data: { tiering: "external" },
  });
  return { searchable, updated: result.count };
}
