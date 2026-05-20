/**
 * Platform operator audit log writer..
 *
 * Mirror primitive to `writeAuditLog` in `audit-chain-insert.ts`, but
 * keyed per deployment instead of per org. Use from privileged operator handlers
 * (suspend, break-glass open/approve/use, backup restore, KMS unwrap).
 *
 *   await writePlatformAuditLog({
 *     deploymentId: DEPLOYMENT_ID,
 *     operatorId: ctx.operator.id,
 *     operatorRole: ctx.operator.role,
 *     action: "grant.approve",
 *     organizationId: grant.organizationId,
 *     reason: input.reason,
 *     entityType: "OrgAccessGrant",
 *     entityId: grant.id,
 *     metadata: { expiresAt: grant.expiresAt },
 *     ipAddress: req.ip,
 *   });
 *
 * Properties:
 *
 *   - The write happens inside an advisory-locked transaction keyed on
 *     `platform-audit:<deploymentId>` so concurrent operator actions don't
 *     race on the chain tail.
 *   - `prevHash` is computed from `PlatformAuditChainTail.lastHash`; if
 *     empty, the genesis hash is `sha256("vf:platform-audit-genesis:" || deploymentId)`.
 *   - When `organizationId` is set, a mirror entry is **caller's
 *     responsibility** — the writer does not auto-fan-out to customer
 *     `AuditLog` because the mirror's `action`/`metadata` shape is
 *     domain-specific (e.g. "VectorFlow Support viewed your secrets"
 *     is a friendlier phrasing than the raw "kms.unwrap"). The
 *     intended pattern is for the calling handler to write to both
 *     logs inside the same outer transaction.
 *   - The Postgres rules in the migration prevent UPDATE/DELETE, so a
 *     compromised operator role cannot tamper after the fact. WORM
 *     long-term retention (e.g. S3 Object Lock) is handled by a
 *     separate sidecar outside this module.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Deployment identifier — the logical name of this VectorFlow
 * deployment. Single-deployment installs default to "default";
 * multi-deployment installs set `VF_DEPLOYMENT_ID` per node.
 */
export const DEPLOYMENT_ID: string = process.env.VF_DEPLOYMENT_ID ?? "default";

export type PlatformActionVerb =
  | "grant.request"
  | "grant.approve"
  | "grant.revoke"
  | "grant.use"
  | "grant.expire"
  | "org.suspend"
  | "org.unsuspend"
  | "org.softdelete"
  | "org.harddelete"
  | "backup.create"
  | "backup.restore"
  | "backup.delete"
  | "deployment.restart"
  | "kms.rotate"
  | "kms.unwrap"
  | "config.change"
  | "operator.login"
  | "operator.logout"
  | (string & {});

export interface WritePlatformAuditLogInput {
  deploymentId?: string;
  operatorId: string | null;
  operatorRole?: "SUPPORT" | "INFRA" | "BILLING" | "INCIDENT" | null;
  action: PlatformActionVerb;
  organizationId?: string | null;
  reason?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: unknown;
  ipAddress?: string | null;
}

export interface WritePlatformAuditLogResult {
  id: string;
  prevHash: string;
  hash: string;
}

/**
 * Genesis hash for the platform-audit chain on a given deployment.
 * Exposed for the verifier script + tests.
 */
export function platformAuditGenesisHash(deploymentId: string): string {
  return sha256Hex(`vf:platform-audit-genesis:${deploymentId}`);
}

/**
 * Canonicalize the row body for hashing. Reuses the same JSON
 * canonicalization rules as `audit-chain.ts` so verifiers can
 * cross-validate.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v ?? null)).join(",")}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${canonicalize(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function computeRowHash(
  prevHash: string,
  row: {
    id: string;
    deploymentId: string;
    operatorId: string | null;
    operatorRole: string | null;
    action: string;
    organizationId: string | null;
    reason: string | null;
    entityType: string | null;
    entityId: string | null;
    metadata: unknown;
    ipAddress: string | null;
    createdAt: Date;
  },
): string {
  // Canonicalize ONLY the chained content fields, never `prevHash` /
  // `hash` themselves — the chain hashes content, not its own self-
  // reference. This lets the verifier pass the full DB row through
  // computeRowHash without first stripping the stored hash columns.
  const canonical = canonicalize({
    id: row.id,
    deploymentId: row.deploymentId,
    operatorId: row.operatorId,
    operatorRole: row.operatorRole,
    action: row.action,
    organizationId: row.organizationId,
    reason: row.reason,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt,
  });
  return sha256Hex(`${prevHash}|${canonical}`);
}

/**
 * Insert a row into `PlatformAuditLog` with a tamper-evidence chain
 * link. Runs inside `prisma.$transaction` with a per-deployment advisory
 * lock so concurrent operator actions on the same deployment serialise on
 * the chain tail.
 *
 * Returns the inserted row's id + chain hashes (for tests / debugging).
 */
export async function writePlatformAuditLog(
  input: WritePlatformAuditLogInput,
): Promise<WritePlatformAuditLogResult> {
  const deploymentId = input.deploymentId ?? DEPLOYMENT_ID;
  // Note: createdAt is captured INSIDE the transaction, after the advisory
  // lock is acquired (see lock acquisition below). Do not hoist it here.

  return prisma.$transaction(async (tx) => {
    // Per-deployment advisory lock — keeps concurrent writers in line so
    // the chain tail is never read stale.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-audit:${deploymentId}`}))`;

    // Capture createdAt after the lock so row timestamps are monotonic
    // with respect to lock-grant order. Hoisting before $transaction lets
    // a writer that waits a long time on the lock produce an earlier
    // timestamp than a writer that committed first — which breaks
    // chain-link reconstruction that relies on insertion order.
    const createdAt = new Date();
    const tail = await tx.platformAuditChainTail.findUnique({
      where: { deploymentId },
      select: { lastHash: true },
    });
    const prevHash = tail?.lastHash ?? platformAuditGenesisHash(deploymentId);

    // Pre-allocate the row id so the hash binds the eventual PK.
    const id = randomCuid();

    const row = {
      id,
      deploymentId,
      operatorId: input.operatorId,
      operatorRole: input.operatorRole ?? null,
      action: input.action,
      organizationId: input.organizationId ?? null,
      reason: input.reason ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? null,
      ipAddress: input.ipAddress ?? null,
      createdAt,
    };
    const hash = computeRowHash(prevHash, row);

    // Include metadata explicitly (even when null) so the stored data matches
    // what computeRowHash canonicalized: a missing property (undefined) is
    // skipped by canonicalize, but null is emitted as "null". Passing null
    // directly works in Prisma 5+ for nullable Json? columns; the @ts-expect-error
    // suppresses the generated type's rejection of null (the generated types
    // are overly strict on this point).
    await tx.platformAuditLog.create({
      data: {
        ...row,
        // @ts-expect-error Prisma types for nullable Json? columns reject null
        // but the runtime and DB handle it correctly (stores SQL NULL).
        metadata: row.metadata,
        prevHash,
        hash,
      },
    });

    await tx.platformAuditChainTail.upsert({
      where: { deploymentId },
      create: { deploymentId, lastHash: hash, lastWriteAt: createdAt, updatedAt: createdAt },
      update: { lastHash: hash, lastWriteAt: createdAt },
    });

    return { id, prevHash, hash };
  });
}

/**
 * Verify a contiguous slice of the chain. Walks rows in `createdAt`
 * order, recomputes each `hash`, and returns the index of the first
 * broken link (or `null` if intact).
 *
 * Exported for the bundled verifier script that ships with the
 * platform-audit export endpoint.
 */
export function verifyPlatformAuditChain(
  rows: Array<{
    id: string;
    deploymentId: string;
    operatorId: string | null;
    operatorRole: string | null;
    action: string;
    organizationId: string | null;
    reason: string | null;
    entityType: string | null;
    entityId: string | null;
    metadata: unknown;
    ipAddress: string | null;
    createdAt: Date;
    prevHash: string;
    hash: string;
  }>,
  expectedGenesis: string,
): { ok: true } | { ok: false; brokenAt: number; reason: string } {
  // Reconstruct canonical chain order by following prevHash links rather than
  // trusting the input slice's sort order. This is safe against:
  //   - Callers that ORDER BY createdAt without a stable tie-breaker (two
  //     writes in the same millisecond can come back in either order).
  //   - Exporters that concatenate partial slices in arbitrary order.
  //
  // Build a map from prevHash → row so we can walk the chain in O(n).
  const byPrevHash = new Map<string, typeof rows[0]>();
  for (const r of rows) {
    if (byPrevHash.has(r.prevHash)) {
      // Two rows with the same prevHash means a chain fork — the input
      // contains a duplicate or corrupted entry. Report at index 0 since
      // we cannot tell which copy is the "real" one without external context.
      return {
        ok: false,
        brokenAt: 0,
        reason: `duplicate prevHash ${r.prevHash} in input — chain fork detected`,
      };
    }
    byPrevHash.set(r.prevHash, r);
  }

  const sorted: typeof rows = [];
  let currentPrev = expectedGenesis;
  while (sorted.length < rows.length) {
    const next = byPrevHash.get(currentPrev);
    if (!next) break; // gap in the chain — will surface as a prevHash mismatch below
    sorted.push(next);
    currentPrev = next.hash;
  }

  // Append any orphan rows that couldn't be threaded (gap means they'll all
  // fail validation; we include them so `brokenAt` points to the right index).
  if (sorted.length < rows.length) {
    const seen = new Set(sorted.map((r) => r.id));
    for (const r of rows) {
      if (!seen.has(r.id)) sorted.push(r);
    }
  }

  let expectedPrev = expectedGenesis;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.prevHash !== expectedPrev) {
      return {
        ok: false,
        brokenAt: i,
        reason: `prevHash mismatch: expected ${expectedPrev}, got ${r.prevHash}`,
      };
    }
    const recomputed = computeRowHash(r.prevHash, r);
    if (recomputed !== r.hash) {
      return {
        ok: false,
        brokenAt: i,
        reason: `hash mismatch: recomputed ${recomputed}, stored ${r.hash}`,
      };
    }
    expectedPrev = r.hash;
  }
  return { ok: true };
}

// ─── Internals ──────────────────────────────────────────────────────────────

/**
 * Minimal cuid-like id generator for environments where Prisma's
 * `cuid()` default isn't reachable (e.g. tests with mocked clients).
 * Production callers should let Prisma's @default(cuid()) supply the
 * id; we generate one here only when we need to hash-bind the id
 * before the row exists.
 */
function randomCuid(): string {
  // cuid2-style: short, sortable-ish, URL-safe. Not collision-free
  // outside this scope, but the table PK + (deploymentId, prevHash) chain
  // bind detection is independent of id uniqueness across stamps.
  const t = Date.now().toString(36);
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 10);
  return `pal_${t}${r1}${r2}`;
}
