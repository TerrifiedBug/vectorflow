import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { errorLog } from "@/lib/logger";
import { env } from "@/lib/env";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";
import {
  computeAuditChainInsert,
  type AuditChainTailLookup,
} from "./audit-chain-insert";
import type { ChainableAuditRow } from "./audit-chain";
import { monotonicFactory } from "ulid";

// Lazily-initialised monotonic ULID factory shared across writeAuditLog
// calls. Required so same-millisecond inserts in one org produce ids whose
// lexicographic order matches insertion order (the chain-tail lookup ties
// on id DESC).
let auditLogMonotonicUlid: (() => string) | null = null;

// Deferred so process.cwd() is not evaluated at module load time.
// The Edge bundler traces into this file (via auto-rollback.ts → instrumentation.ts)
// and rejects any Node-only API that runs during module evaluation.
let _auditLogPath: string | null = null;
export function getAuditLogPath(): string {
  if (_auditLogPath === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require("path") as typeof import("path");
    _auditLogPath =
      env.VF_AUDIT_LOG_PATH ?? join(process.cwd(), ".vectorflow", "audit.jsonl");
  }
  return _auditLogPath;
}

export interface WriteAuditLogParams {
  /**
   * Organization that owns this audit row. Defaults to `DEFAULT_ORG_ID` for
   * OSS backward compatibility, but Cloud callers MUST pass the real org id
   * so the row is correctly chained and tenant-isolated. The orgProcedure
   * tRPC middleware threads `ctx.organizationId` through; pass that here.
   */
  organizationId?: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  diff?: Record<string, { old: unknown; new: unknown }>;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  teamId?: string | null;
  environmentId?: string | null;
}

export async function writeAuditLog(params: WriteAuditLogParams) {
  const organizationId = params.organizationId ?? DEFAULT_ORG_ID;

  // The whole "fetch tail → compute chain → insert" must be atomic so that
  // concurrent writes for the same org cannot produce conflicting chains.
  // We serialize per-org with a Postgres advisory transaction lock; the
  // lock key is a hash of (audit-chain, orgId).
  const log = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit-chain:${organizationId}`}))`;

    // Tail = the most recent row in this org that actually carries a hash.
    // Un-backfilled rows (hash IS NULL) are skipped so we always chain off
    // a real predecessor; backfill walks them separately in (createdAt, id)
    // order. The partial index `AuditLog_organizationId_createdAt_chain_idx
    // WHERE hash IS NOT NULL` makes this lookup a single-row index probe.
    const tail = await tx.auditLog.findFirst({
      where: { organizationId, hash: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { hash: true },
    });

    // The row content the chain hashes over — must match what we actually
    // INSERT. We pre-allocate a CUID and createdAt so the hash is stable.
    const now = new Date();
    const rowToHash: ChainableAuditRow = {
      id: "", // placeholder; replaced below with the cuid Prisma assigns
      organizationId,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      diff: params.diff ?? null,
      metadata: params.metadata ?? null,
      ipAddress: params.ipAddress ?? null,
      userEmail: params.userEmail ?? null,
      userName: params.userName ?? null,
      teamId: params.teamId ?? null,
      environmentId: params.environmentId ?? null,
      createdAt: now,
    };

    // We need a stable id BEFORE computing the hash. ULIDs are sortable
    // across milliseconds but the standard `ulid()` is random within a
    // single millisecond, which would let two same-ms inserts in one org
    // disagree on tail order. Use `monotonicFactory` so within a ms the
    // random part is incremented monotonically — id-DESC ordering then
    // matches insertion order.
    const ulid = (auditLogMonotonicUlid ??= monotonicFactory());
    rowToHash.id = `audit_${ulid()}`;

    const { prevHash, hash } = computeAuditChainInsert(rowToHash, tail?.hash ?? null);

    return tx.auditLog.create({
      data: {
        id: rowToHash.id,
        organizationId,
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        diff: params.diff as unknown as Prisma.InputJsonValue,
        metadata: params.metadata as unknown as Prisma.InputJsonValue,
        ipAddress: params.ipAddress,
        userEmail: params.userEmail,
        userName: params.userName,
        teamId: params.teamId,
        environmentId: params.environmentId,
        createdAt: now,
        prevHash,
        hash,
      },
    });
  });

  const jsonLine =
    JSON.stringify({
      id: log.id,
      organizationId: log.organizationId,
      timestamp: log.createdAt.toISOString(),
      action: log.action,
      userId: log.userId,
      userEmail: log.userEmail,
      userName: log.userName,
      entityType: log.entityType,
      entityId: log.entityId,
      teamId: log.teamId,
      environmentId: log.environmentId,
      ipAddress: log.ipAddress,
      metadata: log.metadata,
      diff: log.diff,
      prevHash: log.prevHash,
      hash: log.hash,
    }) + "\n";

  const auditLogPath = getAuditLogPath();
  try {
    // Dynamically import Node-only fs modules to keep this file Edge-bundle safe.
    const { appendFile, mkdir } = await import("fs/promises");
    const { dirname } = await import("path");
    await mkdir(dirname(auditLogPath), { recursive: true });
    await appendFile(auditLogPath, jsonLine);
  } catch (error) {
    // File write failure should not break audit logging to DB
    errorLog("audit", `Failed to append audit event to file: ${auditLogPath}`, error);
  }

  return log;
}

// Re-export for callers that want to drive their own chain inserts (e.g.
// the PlatformAuditLog writer that lives in cloud/).
export type { AuditChainTailLookup };
