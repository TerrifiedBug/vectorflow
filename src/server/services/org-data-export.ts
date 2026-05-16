// src/server/services/org-data-export.ts
//
// GDPR Article 20 data-portability export for a single organization.
// Produces a versioned, content-checksummed JSON envelope containing
// everything the customer would reasonably consider "their data": pipeline
// configs, fleet metadata, alert rules and channel destinations, audit log,
// org membership, team and environment structure.
//
// Deliberately excluded:
//   - Encrypted secret payloads (Secret.encryptedValue, channel encrypted
//     bodies, webhook encryptedSecret). The customer cannot decrypt these
//     outside this Cloud instance because the DEK is wrapped by AWS KMS;
//     exporting opaque ciphertext is theatre. Each excluded field is
//     surfaced in the manifest with a presence flag so the customer knows
//     a secret exists without seeing its bytes.
//   - PII of operators (vectorflow-cloud staff). Not the customer's data.
//   - kmsGrantToken on OrgAccessGrant rows; surface presence only.
//
// The envelope is content-addressed by a SHA-256 over a deterministic
// canonical JSON serialization of `data`. The customer can re-compute
// the checksum offline to verify tamper-evidence.
//
// Library only; the org-scoped HTTP endpoint that exposes this needs an
// org-admin auth surface (WebAuthn/passkey + OrgMember check) that lives
// in vectorflow-cloud — see plan §5.

import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { prisma } from "@/lib/prisma";

export const ORG_DATA_EXPORT_SCHEMA_VERSION = 1 as const;

export interface OrgDataExportEnvelope {
  version: typeof ORG_DATA_EXPORT_SCHEMA_VERSION;
  exportId: string;
  generatedAt: string;
  organizationId: string;
  manifest: {
    /** rowCounts.<tableName> \u2192 count. */
    rowCounts: Record<string, number>;
    /** Tables/fields deliberately omitted from the export. */
    excluded: Array<{ scope: string; reason: string }>;
    /**
     * Tables whose `findMany` returned exactly `perTableLimit` rows \u2014 i.e.
     * the read was capped and there may be additional rows in the
     * underlying table. Customers/auditors seeing entries here know the
     * export is incomplete and must page through a larger window.
     */
    truncated: Array<{ scope: string; returnedRows: number; limit: number }>;
    /** SHA-256 hex over canonicalize(data). */
    contentChecksumSha256: string;
  };
  data: OrgDataExportPayload;
}

export interface OrgDataExportPayload {
  organization: Record<string, unknown> | null;
  organizationSettings: Record<string, unknown> | null;
  teams: Array<Record<string, unknown>>;
  environments: Array<Record<string, unknown>>;
  vectorNodes: Array<Record<string, unknown>>;
  pipelines: Array<Record<string, unknown>>;
  pipelineVersions: Array<Record<string, unknown>>;
  alertRules: Array<Record<string, unknown>>;
  alertChannels: Array<Record<string, unknown>>;
  webhookEndpoints: Array<Record<string, unknown>>;
  auditLog: Array<Record<string, unknown>>;
  orgMembers: Array<Record<string, unknown>>;
  /**
   * Tenant user identities for everyone in `orgMembers`. Includes id,
   * email, name, authMethod, lockedAt, createdAt; excludes passwordHash
   * and image. Lets the customer reconstruct who-was-who from the
   * userId references in `orgMembers` (without exposing operator
   * accounts, which live in `PlatformOperator`, not `User`).
   */
  tenantUsers: Array<Record<string, unknown>>;
  orgAccessGrants: Array<Record<string, unknown>>;
}

export interface BuildOrgDataExportOpts {
  /** Abort signal honoured between table reads. */
  signal?: AbortSignal;
  /**
   * Cap rows fetched per table. Defaults to 100_000; tables above the cap
   * are truncated with a note in the manifest. Customers with that much
   * data fall back to a paged export endpoint (out of scope).
   */
  perTableLimit?: number;
  /** Stable timestamp for deterministic tests; defaults to new Date(). */
  now?: Date;
}

const DEFAULT_PER_TABLE_LIMIT = 100_000;

/**
 * Build a complete org data export. Reads every tenant table scoped to
 * `organizationId`, redacts ciphertext-only fields to boolean presence
 * flags, computes a content checksum over a canonical JSON serialisation
 * of the data block, and returns the wrapped envelope.
 *
 * The function reads with the global prisma client by design: Cloud
 * deployments wrap this in `withOrgTx(orgId, …)` at the call site so RLS
 * fences the reads; OSS deployments rely on application-level org
 * filtering, which `where: { organizationId }` provides directly.
 */
export async function buildOrgDataExport(
  organizationId: string,
  opts: BuildOrgDataExportOpts = {},
): Promise<OrgDataExportEnvelope> {
  const limit = opts.perTableLimit ?? DEFAULT_PER_TABLE_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(
      `buildOrgDataExport: perTableLimit must be a positive finite number (got ${limit}). Non-positive values would make every table look truncated.`,
    );
  }
  const signal = opts.signal;
  const now = opts.now ?? new Date();
  const checkpoint = () => {
    if (signal?.aborted) {
      throw new Error("buildOrgDataExport: aborted");
    }
  };

  checkpoint();
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!organization) {
    throw new Error(
      `buildOrgDataExport: no organization with id ${organizationId}`,
    );
  }
  // Redact envelope-encryption ciphertext + KMS ARNs from the org row.
  const orgRedacted = redactKeys(organization, [
    "dataKeyCiphertext",
    "kmsKeyArn",
    "byokKeyArn",
  ]);

  checkpoint();
  const organizationSettingsRaw =
    await prisma.organizationSettings.findUnique({
      where: { organizationId },
    });
  // OrganizationSettings holds live operational credentials (OIDC client
  // secret, SCIM bearer token, S3 secret access key). Redact them to
  // presence flags so the export still tells the customer that SSO/SCIM/
  // S3 backups are configured without leaking the secret material.
  const organizationSettings = redactKeys(organizationSettingsRaw, [
    "oidcClientSecret",
    "scimBearerToken",
    "s3AccessKeyId",
    "s3SecretAccessKey",
  ]);

  checkpoint();
  const teams = await prisma.team.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  checkpoint();
  const environments = await prisma.environment.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  checkpoint();
  const vectorNodes = await prisma.vectorNode.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  checkpoint();
  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  checkpoint();
  const pipelineVersions = await prisma.pipelineVersion.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  checkpoint();
  const alertRules = await prisma.alertRule.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { id: "asc" },
  });

  checkpoint();
  // NotificationChannel + WebhookEndpoint hold encrypted destination
  // credentials. We strip the encrypted payload but keep enough to identify
  // the channel (name, type, target URL host) so a customer can recreate
  // the channel against the destination they already know about.
  const alertChannelsRaw = await prisma.notificationChannel.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  const alertChannels = alertChannelsRaw.map((c) =>
    redactKeys(c, ["config"]),
  );

  checkpoint();
  const webhookEndpointsRaw = await prisma.webhookEndpoint.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  const webhookEndpoints = webhookEndpointsRaw.map((w) =>
    redactKeys(w, ["encryptedSecret"]),
  );

  checkpoint();
  const auditLog = await prisma.auditLog.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  checkpoint();
  const orgMembers = await prisma.orgMember.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  checkpoint();
  // Tenant users referenced from orgMembers. Use an explicit `select` so
  // sensitive User columns (totpSecret, totpBackupCodes, isSuperAdmin,
  // mustChangePassword, lockedBy, scimExternalId, passwordHash, image)
  // never leave the database row \u2014 they're not portability data, and
  // some are credential material that a leak would compromise. Whitelist
  // only the identity fields the customer needs to map orgMembers.userId
  // to a real person.
  const memberUserIds = orgMembers.map((m) => m.userId as string);
  const tenantUsers = memberUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: memberUserIds } },
        take: limit,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          email: true,
          name: true,
          authMethod: true,
          lockedAt: true,
          totpEnabled: true,
          createdAt: true,
        },
      })
    : [];
  checkpoint();
  const orgAccessGrantsRaw = await prisma.orgAccessGrant.findMany({
    where: { organizationId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  const orgAccessGrants = orgAccessGrantsRaw.map((g) =>
    redactKeys(g, ["kmsGrantToken"]),
  );

  const data: OrgDataExportPayload = {
    organization: orgRedacted,
    organizationSettings: organizationSettings ?? null,
    teams,
    environments,
    vectorNodes,
    pipelines,
    pipelineVersions,
    alertRules,
    alertChannels,
    webhookEndpoints,
    auditLog,
    orgMembers,
    tenantUsers,
    orgAccessGrants,
  };

  const rowCounts: Record<string, number> = {
    organization: orgRedacted ? 1 : 0,
    organizationSettings: organizationSettings ? 1 : 0,
    teams: teams.length,
    environments: environments.length,
    vectorNodes: vectorNodes.length,
    pipelines: pipelines.length,
    pipelineVersions: pipelineVersions.length,
    alertRules: alertRules.length,
    alertChannels: alertChannels.length,
    webhookEndpoints: webhookEndpoints.length,
    auditLog: auditLog.length,
    orgMembers: orgMembers.length,
    tenantUsers: tenantUsers.length,
    orgAccessGrants: orgAccessGrants.length,
  };

  // A read that returned exactly `limit` rows is the canonical "may be
  // truncated" signal. False positives (a table that happens to hold
  // exactly `limit` rows) are harmless \u2014 the operator can re-run with a
  // larger cap or verify by re-counting; false negatives would silently
  // serve a partial export, which is what we MUST NOT do.
  const truncated: OrgDataExportEnvelope["manifest"]["truncated"] = [];
  const truncationCandidates: Array<[string, number]> = [
    ["teams", teams.length],
    ["environments", environments.length],
    ["vectorNodes", vectorNodes.length],
    ["pipelines", pipelines.length],
    ["pipelineVersions", pipelineVersions.length],
    ["alertRules", alertRules.length],
    ["alertChannels", alertChannels.length],
    ["webhookEndpoints", webhookEndpoints.length],
    ["auditLog", auditLog.length],
    ["orgMembers", orgMembers.length],
    ["tenantUsers", tenantUsers.length],
    ["orgAccessGrants", orgAccessGrants.length],
  ];
  for (const [scope, count] of truncationCandidates) {
    if (count >= limit) {
      truncated.push({ scope, returnedRows: count, limit });
    }
  }

  const excluded = [
    {
      scope: "Organization.dataKeyCiphertext / kmsKeyArn / byokKeyArn",
      reason:
        "Per-org DEK ciphertext and KMS ARNs are operational metadata; not portable customer data.",
    },
    {
      scope: "NotificationChannel.config",
      reason:
        "Channel destination credentials are AES-256-GCM encrypted with the per-org DEK and cannot be decrypted outside this Cloud instance. Recreate the channel against the destination directly.",
    },
    {
      scope: "WebhookEndpoint.encryptedSecret",
      reason:
        "Outbound-webhook signing secret encrypted with the per-org DEK. Recreate the endpoint and rotate the secret if needed.",
    },
    {
      scope: "OrgAccessGrant.kmsGrantToken",
      reason:
        "Live KMS decrypt-grant token; surfacing it would defeat its time-bound purpose. Presence is preserved.",
    },
    {
      scope: "Secret (entire model)",
      reason:
        "Secret values are stored as ciphertext-only; exporting opaque bytes is not useful. Secrets must be re-entered against the destination system.",
    },
    {
      scope: "User.passwordHash / User.image",
      reason:
        "Tenant user identities ARE included in the `tenantUsers` block (id, email, name, authMethod, lockedAt, createdAt) so customers can reconstruct who-was-who from `orgMembers.userId`. The passwordHash and profile image are excluded.",
    },
    {
      scope: "PlatformOperator (entire model)",
      reason:
        "Operators are vectorflow-cloud staff identities, not tenant members. Their data is out of scope for tenant-data portability.",
    },
  ];

  const contentChecksumSha256 = checksumCanonical(data);

  return {
    version: ORG_DATA_EXPORT_SCHEMA_VERSION,
    exportId: ulid(now.getTime()),
    generatedAt: now.toISOString(),
    organizationId,
    manifest: {
      rowCounts,
      excluded,
      truncated,
      contentChecksumSha256,
    },
    data,
  };
}

/**
 * Re-compute the canonical content checksum over a payload block. Use this
 * to verify a downloaded envelope's integrity offline: the result should
 * match `envelope.manifest.contentChecksumSha256`.
 */
export function checksumCanonical(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

/**
 * Deterministic, key-sorted JSON canonicalisation. Output is stable across
 * Node versions: object keys are sorted lexicographically; arrays preserve
 * order; primitives encode via JSON.stringify; undefined fields are
 * dropped (matching JSON.stringify semantics).
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => {
      const c = canonicalize(v);
      return c === "" ? "null" : c;
    });
    return `[${parts.join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${canonicalize(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  // Fallback (function, symbol, bigint) — match JSON.stringify behaviour.
  return JSON.stringify(value as never) ?? "";
}

function redactKeys<T extends Record<string, unknown>>(
  row: T,
  keys: ReadonlyArray<keyof T & string>,
): Record<string, unknown>;
function redactKeys<T extends Record<string, unknown>>(
  row: T | null,
  keys: ReadonlyArray<keyof T & string>,
): Record<string, unknown> | null;
function redactKeys<T extends Record<string, unknown>>(
  row: T | null,
  keys: ReadonlyArray<keyof T & string>,
): Record<string, unknown> | null {
  if (row == null) return null;
  const out: Record<string, unknown> = {};
  const redacted: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(row)) {
    if ((keys as ReadonlyArray<string>).includes(k)) {
      redacted[`__has_${k}`] = v != null;
      continue;
    }
    out[k] = v;
  }
  // Surface presence-only redaction flags so the customer can see what we
  // deliberately omitted without losing the signal that something existed.
  for (const [flagKey, flagValue] of Object.entries(redacted)) {
    out[flagKey] = flagValue;
  }
  return out;
}
