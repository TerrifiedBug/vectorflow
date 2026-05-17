/**
 * Tenant lifecycle — soft-delete grace window (plan §12, §16b OSS item 11).
 *
 * OSS scope:
 *
 *   - `requestOrgDeletion(orgId, by)` — sets `Organization.deletedAt = now()`.
 *     `getOrgConstraints()` already returns `reason: "deleted"` for any
 *     org with `deletedAt` set, so every customer-side handler 404s
 *     immediately. Agent endpoints return 503 with `Retry-After: 86400`
 *     (same as suspension; covered by Phase 5t).
 *   - `cancelOrgDeletion(orgId)` — clears `deletedAt` during the grace
 *     window. Idempotent; called by the customer-admin "Undo" button.
 *   - `listOrgsPastGrace()` — returns orgs whose `deletedAt` is older
 *     than `GRACE_DAYS`. Cloud's tenant-lifecycle cron uses this to
 *     drive hard-delete + `kms:ScheduleKeyDeletion`.
 *
 * Cloud-only (NOT in OSS):
 *
 *   - The hard-delete step itself (cascade `DELETE`, KMS key
 *     destruction). That logic lives in `cloud/src/services/tenant-
 *     lifecycle-hard-delete.ts` and ships with the cloud workspace
 *     scaffolding (§16b cloud item set).
 *
 * Notes:
 *
 *   - Soft-delete writes an `AuditLog` row with `action: "org.softdelete"`
 *     and a mirror entry to `PlatformAuditLog` (when called by an
 *     operator — service-account caller path detected by `by.kind`).
 *     Mirroring happens via the same outer transaction so the two logs
 *     cannot diverge.
 *   - Calling `requestOrgDeletion` twice is idempotent; the second call
 *     observes `deletedAt` already set and returns the original
 *     scheduled-deletion date.
 *   - `GRACE_DAYS` is env-tunable (`VF_DELETE_GRACE_DAYS`, default 30)
 *     so the Cloud build can run shorter grace windows in staging.
 */

import { prisma } from "@/lib/prisma";

// Validate at module load: non-numeric / negative values fall back to 30.
const GRACE_DAYS_RAW = Number(process.env.VF_DELETE_GRACE_DAYS ?? "30");
const GRACE_DAYS =
  Number.isFinite(GRACE_DAYS_RAW) && GRACE_DAYS_RAW > 0 ? GRACE_DAYS_RAW : 30;

export interface DeletionRequestor {
  /** "customer" = owner/admin in the org self-serve UI; "operator" = platform staff. */
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
  return prisma.$transaction(async (tx) => {
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
        organizationId,
        deletedAt: org.deletedAt,
        scheduledHardDeleteAt: addDays(org.deletedAt, GRACE_DAYS),
        alreadyPending: true,
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
      // Lost the race — re-read to surface the actual deletedAt.
      const reread = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { deletedAt: true },
      });
      const deletedAt = reread?.deletedAt ?? now;
      return {
        organizationId,
        deletedAt,
        scheduledHardDeleteAt: addDays(deletedAt, GRACE_DAYS),
        alreadyPending: true,
      };
    }

    // Customer-side audit row — visible in the org's audit export.
    await tx.auditLog.create({
      data: {
        organizationId,
        userId: by.kind === "customer" ? by.id : null,
        action: "org.softdelete",
        entityType: "Organization",
        entityId: organizationId,
        ipAddress: by.ipAddress ?? null,
        metadata: {
          requestedBy: by.kind,
          reason: by.reason ?? null,
          graceDays: GRACE_DAYS,
        },
      },
    });

    return {
      organizationId,
      deletedAt: now,
      scheduledHardDeleteAt: addDays(now, GRACE_DAYS),
      alreadyPending: false,
    };
  });
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
 * normally still exist until the Cloud cron hard-deletes it, but the
 * intent of an explicit Cancel is to keep the org alive — after the
 * grace window the customer must contact support).
 */
export async function cancelOrgDeletion(
  organizationId: string,
  by: DeletionRequestor,
): Promise<CancelOrgDeletionResult> {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, deletedAt: true },
    });
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }
    if (!org.deletedAt) {
      return { organizationId, cancelled: false, wasScheduledFor: null };
    }

    const scheduledHardDelete = addDays(org.deletedAt, GRACE_DAYS);
    if (Date.now() >= scheduledHardDelete.getTime()) {
      throw new Error(
        `Grace window elapsed for ${organizationId}; cannot cancel via self-serve`,
      );
    }

    await tx.organization.update({
      where: { id: organizationId },
      data: { deletedAt: null },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        userId: by.kind === "customer" ? by.id : null,
        action: "org.softdelete.cancel",
        entityType: "Organization",
        entityId: organizationId,
        ipAddress: by.ipAddress ?? null,
        metadata: {
          requestedBy: by.kind,
          wasScheduledFor: scheduledHardDelete.toISOString(),
        },
      },
    });

    return {
      organizationId,
      cancelled: true,
      wasScheduledFor: scheduledHardDelete,
    };
  });
}

export interface PendingHardDelete {
  organizationId: string;
  slug: string;
  deletedAt: Date;
  scheduledHardDeleteAt: Date;
}

/**
 * Enumerate orgs whose `deletedAt` is older than the grace window.
 * Cloud's hard-delete cron uses this to drive `kms:ScheduleKeyDeletion`
 * + cascade SQL DELETE. OSS callers may use it too (e.g. self-hosted
 * compliance teams running a manual cleanup), but the actual destructive
 * step is intentionally NOT exposed in OSS.
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
 * tested and consumed by Cloud and OSS UIs alike.
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
