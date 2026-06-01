/**
 * Tenant lifecycle — soft-delete grace window..
 *
 * OSS scope:
 *
 *   - `requestOrgDeletion(orgId, by)` — sets `Organization.deletedAt = now()`.
 *     `getOrgConstraints()` already returns `reason: "deleted"` for any
 *     org with `deletedAt` set, so every customer-side handler 404s
 *     immediately. Agent endpoints return 503 with `Retry-After: 86400`
 *     (same as suspension).
 *   - `cancelOrgDeletion(orgId)` — clears `deletedAt` during the grace
 *     window. Idempotent; called by the customer-admin "Undo" button.
 *   - `listOrgsPastGrace()` — returns orgs whose `deletedAt` is older
 *     than `GRACE_DAYS`. A tenant-lifecycle cron uses this to drive
 *     hard-delete + `kms:ScheduleKeyDeletion`.
 *
 * Notes:
 *
 *   - Soft-delete writes an `AuditLog` row with `action: "org.softdelete"`
 *     via the chained `writeAuditLog` path so `prevHash`/`hash` are
 *     populated and the rows appear in chain exports.
 *   - The `writeAuditLog` call runs OUTSIDE the org-update transaction
 *     (because `writeAuditLog` opens its own advisory-locked transaction
 *     internally). A write failure is logged but does not roll back the
 *     soft-delete — the org state is authoritative; the audit row is
 *     best-effort append.
 *   - Calling `requestOrgDeletion` twice is idempotent; the second call
 *     observes `deletedAt` already set and returns the original
 *     scheduled-deletion date.
 *   - `GRACE_DAYS` is env-tunable (`VF_DELETE_GRACE_DAYS`, default 30)
 *     so operators can run shorter grace windows in staging.
 */

import { prisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import { writeAuditLog } from "@/server/services/audit";
import { errorLog } from "@/lib/logger";

// Validate at module load: non-numeric / negative values fall back to 30.
const GRACE_DAYS_RAW = Number(process.env.VF_DELETE_GRACE_DAYS ?? "30");
const GRACE_DAYS =
  Number.isFinite(GRACE_DAYS_RAW) && GRACE_DAYS_RAW > 0 ? GRACE_DAYS_RAW : 30;

export interface DeletionRequestor {
  /** "customer" = owner/admin in the org self-serve UI; "operator" = a platform-operator account. */
  kind: "customer" | "operator";
  /** User.id when kind === "customer"; PlatformOperator.id when kind === "operator". */
  id: string;
  /** Source IP for audit. */
  ipAddress?: string | null;
  /** Free-text reason (required for operator-driven deletes). */
  reason?: string | null;
}

export interface RequestOrgDeletionResult {
  organizationId: string;
  deletedAt: Date;
  scheduledHardDeleteAt: Date;
  alreadyPending: boolean;
}

/**
 * Mark an org for deletion. Sets `Organization.deletedAt = now()` and
 * writes the relevant audit rows. Returns the (possibly pre-existing)
 * deletedAt + the scheduled hard-delete date so the customer-admin UI
 * can render the countdown banner.
 *
 * Idempotent: a second call observes the existing deletedAt and
 * returns it unchanged.
 */
export async function requestOrgDeletion(
  organizationId: string,
  by: DeletionRequestor,
): Promise<RequestOrgDeletionResult> {
  // Step 1: atomic org update (advisory lock not needed; updateMany CAS is sufficient).
  const result = await withOrgTx(organizationId, async (tx) => {
    // Verify the org exists before attempting the atomic update.
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, deletedAt: true },
    });
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    if (org.deletedAt) {
      return {
        deletedAt: org.deletedAt,
        alreadyPending: true as const,
        wrote: false,
      };
    }

    const now = new Date();
    // Atomic compare-and-set: only transition if deletedAt is still null.
    // Prevents a race where two concurrent calls both observe deletedAt=null
    // and both execute the update + audit path.
    const { count } = await tx.organization.updateMany({
      where: { id: organizationId, deletedAt: null },
      data: { deletedAt: now },
    });

    if (count === 0) {
      // Lost the CAS race — re-read to surface the actual deletedAt.
      const reread = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { deletedAt: true },
      });
      if (!reread) {
        // Org was hard-deleted between our read and the CAS write.
        throw new Error(`Organization ${organizationId} not found`);
      }
      if (reread.deletedAt === null) {
        // A concurrent cancelOrgDeletion cleared deletedAt BETWEEN our initial
        // read (which saw null) and the CAS write. The org is currently active.
        // Throw so the caller can retry; surfacing a fabricated pending-date here
        // would incorrectly report a deletion that was never committed.
        throw new Error(
          `Organization ${organizationId} had no pending deletion (concurrent cancel detected); retry the request`,
        );
      }
      return {
        deletedAt: reread.deletedAt,
        alreadyPending: true as const,
        wrote: false,
      };
    }

    return { deletedAt: now, alreadyPending: false as const, wrote: true };
  });

  // Step 2: write the chained audit row OUTSIDE the transaction so
  // writeAuditLog's advisory lock does not nest inside the org update tx.
  if (result.wrote) {
    writeAuditLog({
      organizationId,
      userId: by.kind === "customer" ? by.id : null,
      action: "org.softdelete",
      entityType: "Organization",
      entityId: organizationId,
      ipAddress: by.ipAddress ?? null,
      metadata: {
        requestedBy: by.kind,
        // Preserve operator attribution: store the operator's ID in
        // metadata so the audit row is traceable even though userId is null.
        ...(by.kind === "operator" && { operatorId: by.id }),
        reason: by.reason ?? null,
        graceDays: GRACE_DAYS,
      },
    }).catch((err) => {
      errorLog(
        "tenant-lifecycle",
        `writeAuditLog failed for org.softdelete on ${organizationId}`,
        err,
      );
    });
  }

  return {
    organizationId,
    deletedAt: result.deletedAt,
    scheduledHardDeleteAt: addDays(result.deletedAt, GRACE_DAYS),
    alreadyPending: result.alreadyPending,
  };
}

export interface CancelOrgDeletionResult {
  organizationId: string;
  cancelled: boolean;
  /** When the deletion was originally scheduled, if there was one. */
  wasScheduledFor: Date | null;
}

/**
 * Undo a pending soft-delete during the grace window. Idempotent: if
 * the org was not pending deletion, returns `cancelled: false` without
 * raising.
 *
 * Throws if the grace window has already elapsed (the row would
 * normally still exist until the hard-delete cron runs, but the intent
 * of an explicit Cancel is to keep the org alive — after the grace
 * window the customer must contact support).
 */
export async function cancelOrgDeletion(
  organizationId: string,
  by: DeletionRequestor,
): Promise<CancelOrgDeletionResult> {
  // Step 1: atomic org update.
  const result = await withOrgTx(organizationId, async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, deletedAt: true },
    });
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }
    if (!org.deletedAt) {
      return { cancelled: false, wasScheduledFor: null, wrote: false };
    }

    const scheduledHardDelete = addDays(org.deletedAt, GRACE_DAYS);
    if (Date.now() >= scheduledHardDelete.getTime()) {
      throw new Error(
        `Grace window elapsed for ${organizationId}; cannot cancel via self-serve`,
      );
    }

    // Atomic compare-and-set: only cancel if deletedAt is still set.
    // Guards against concurrent cancel requests both succeeding.
    const { count } = await tx.organization.updateMany({
      where: { id: organizationId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });

    if (count === 0) {
      // Another concurrent request already cancelled; treat as success.
      return { cancelled: true, wasScheduledFor: scheduledHardDelete, wrote: false };
    }

    return { cancelled: true, wasScheduledFor: scheduledHardDelete, wrote: true };
  });

  // Step 2: write the chained audit row OUTSIDE the transaction.
  if (result.wrote && result.wasScheduledFor) {
    const scheduledFor = result.wasScheduledFor;
    writeAuditLog({
      organizationId,
      userId: by.kind === "customer" ? by.id : null,
      action: "org.softdelete.cancel",
      entityType: "Organization",
      entityId: organizationId,
      ipAddress: by.ipAddress ?? null,
      metadata: {
        requestedBy: by.kind,
        // Preserve operator attribution.
        ...(by.kind === "operator" && { operatorId: by.id }),
        wasScheduledFor: scheduledFor.toISOString(),
      },
    }).catch((err) => {
      errorLog(
        "tenant-lifecycle",
        `writeAuditLog failed for org.softdelete.cancel on ${organizationId}`,
        err,
      );
    });
  }

  return {
    organizationId,
    cancelled: result.cancelled,
    wasScheduledFor: result.wasScheduledFor,
  };
}

export interface PendingHardDelete {
  organizationId: string;
  slug: string;
  deletedAt: Date;
  scheduledHardDeleteAt: Date;
}

/**
 * Enumerate orgs whose `deletedAt` is older than the grace window.
 * Callers wire this into a hard-delete cron (cascade SQL DELETE +
 * `kms:ScheduleKeyDeletion`) appropriate for their deployment model.
 */
export async function listOrgsPastGrace(
  now: Date = new Date(),
): Promise<PendingHardDelete[]> {
  const cutoff = addDays(now, -GRACE_DAYS);
  const rows = await prisma.organization.findMany({
    where: {
      deletedAt: { not: null, lte: cutoff },
    },
    select: { id: true, slug: true, deletedAt: true },
  });
  return rows
    .filter((r): r is { id: string; slug: string; deletedAt: Date } => r.deletedAt !== null)
    .map((r) => ({
      organizationId: r.id,
      slug: r.slug,
      deletedAt: r.deletedAt,
      scheduledHardDeleteAt: addDays(r.deletedAt, GRACE_DAYS),
    }));
}

/**
 * Banner spec for the customer-admin UI. The org's deletedAt + grace
 * window resolve into the message + days-remaining the dashboard
 * surfaces. Exposed as a pure function so the same shape can be unit-
 * tested and consumed by every UI that renders the banner.
 */
export interface DeletionBanner {
  shown: boolean;
  deletedAt: Date | null;
  scheduledHardDeleteAt: Date | null;
  daysRemaining: number | null;
  message: string | null;
}

export function describeDeletionBanner(
  deletedAt: Date | null,
  now: Date = new Date(),
): DeletionBanner {
  if (!deletedAt) {
    return {
      shown: false,
      deletedAt: null,
      scheduledHardDeleteAt: null,
      daysRemaining: null,
      message: null,
    };
  }
  const scheduledHardDeleteAt = addDays(deletedAt, GRACE_DAYS);
  const daysRemaining = Math.max(
    0,
    Math.ceil((scheduledHardDeleteAt.getTime() - now.getTime()) / DAY_MS),
  );
  const message =
    daysRemaining === 0
      ? "This organization is scheduled for permanent deletion. Contact support to restore."
      : `This organization is scheduled for permanent deletion in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}. An owner can cancel from Settings → Danger zone.`;
  return {
    shown: true,
    deletedAt,
    scheduledHardDeleteAt,
    daysRemaining,
    message,
  };
}

// ─── Internals ──────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}
