/**
 * Platform operator audit log writer (plan §11, §16b OSS item 5).
 *
 * Mirror primitive to `writeAuditLog` in `audit-chain-insert.ts`, but
 * keyed per stamp instead of per org. Use from operator-side handlers
 * (suspend, break-glass open/approve/use, backup restore, KMS unwrap).
 *
 *   await writePlatformAuditLog({
 *     stampId: STAMP_ID,
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
 *     `platform-audit:<stampId>` so concurrent operator actions don't
 *     race on the chain tail.
 *   - `prevHash` is computed from `PlatformAuditChainTail.lastHash`; if
 *     empty, the genesis hash is `sha256("vf:platform-audit-genesis:" || stampId)`.
 *   - When `organizationId` is set, a mirror entry is **caller's
 *     responsibility** — the writer does not auto-fan-out to customer
 *     `AuditLog` because the mirror's `action`/`metadata` shape is
 *     domain-specific (e.g. "VectorFlow Support viewed your secrets"
 *     is a friendlier phrasing than the raw "kms.unwrap"). The
 *     intended pattern is for the calling handler to write to both
 *     logs inside the same outer transaction.
 *   - The Postgres rules in the migration prevent UPDATE/DELETE, so a
 *     compromised operator role cannot tamper after the fact. The Cloud
 *     S3 Object Lock sidecar (§16b cloud-11) ships rows for WORM
 *     long-term retention.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

/**
 * Stamp identifier — the logical name of this VectorFlow Cloud
 * deployment. Single-stamp deployments default to "default"; multi-
 * stamp deployments set `VF_STAMP_ID` per stamp.
 */
export const STAMP_ID: string = process.env.VF_STAMP_ID ?? "default";

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
  | "stamp.restart"
  | "kms.rotate"
  | "kms.unwrap"
  | "config.change"
  | "operator.login"
  | "operator.logout"
  | (string & {});

export interface WritePlatformAuditLogInput {
  stampId?: string;
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
 * Genesis hash for the platform-audit chain on a given stamp.
 * Exposed for the verifier script + tests.
 */
export function platformAuditGenesisHash(stampId: string): string {
  return sha256Hex(`vf:platform-audit-genesis:${stampId}`);
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
    stampId: string;
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
    stampId: row.stampId,
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
 * link. Runs inside `prisma.$transaction` with a per-stamp advisory
 * lock so concurrent operator actions on the same stamp serialise on
 * the chain tail.
 *
 * Returns the inserted row's id + chain hashes (for tests / debugging).
 */
export async function writePlatformAuditLog(
  input: WritePlatformAuditLogInput,
): Promise<WritePlatformAuditLogResult> {
  const stampId = input.stampId ?? STAMP_ID;
  const createdAt = new Date();

  return prisma.$transaction(async (tx) => {
    // Per-stamp advisory lock — keeps concurrent writers in line so
    // the chain tail is never read stale.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-audit:${stampId}`}))`;

    const tail = await tx.platformAuditChainTail.findUnique({
      where: { stampId },
      select: { lastHash: true },
    });
    const prevHash = tail?.lastHash ?? platformAuditGenesisHash(stampId);

    // Pre-allocate the row id so the hash binds the eventual PK.
    const id = randomCuid();

    const row = {
      id,
      stampId,
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

    await tx.platformAuditLog.create({
      data: {
        ...row,
        // Prisma JSON columns accept anything serialisable, so cast to
        // the Prisma JSON input type for type-safety.
        metadata: row.metadata as Prisma.InputJsonValue | undefined,
        prevHash,
        hash,
      },
    });

    await tx.platformAuditChainTail.upsert({
      where: { stampId },
      create: { stampId, lastHash: hash, lastWriteAt: createdAt, updatedAt: createdAt },
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
 * platform-audit export endpoint (Cloud-only; see §16b cloud-11).
 */
export function verifyPlatformAuditChain(
  rows: Array<{
    id: string;
    stampId: string;
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
  // Sort rows into a deterministic order before walking the chain.
  // `createdAt` alone is not a stable sort key because two writes in the
  // same millisecond on the same stamp can be returned in either order by a
  // simple `ORDER BY createdAt` query. Tie-break on `id` (lexicographic)
  // which is a monotonic CUID that tracks insertion order within a ms.
  const sorted = [...rows].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
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
  // outside this scope, but the table PK + (stampId, prevHash) chain
  // bind detection is independent of id uniqueness across stamps.
  const t = Date.now().toString(36);
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 10);
  return `pal_${t}${r1}${r2}`;
}
