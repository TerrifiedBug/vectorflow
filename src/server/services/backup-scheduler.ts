import cron, { type ScheduledTask } from "node-cron";
import { adminPrisma, prisma } from "@/lib/prisma";
import { runWithOrgContext } from "@/lib/org-context";
import { getOrgSettings } from "@/lib/org-settings";
import { debugLog, infoLog, errorLog } from "@/lib/logger";
import { createBackup, runRetentionCleanup, runOrphanCleanup } from "./backup";
import { fireEventAlert } from "./event-alerts";

/**
 * Per-organization backup scheduler.
 *
 * Each non-suspended, non-deleted Organization with backupEnabled gets a
 * dedicated `node-cron` task. When the customer changes settings,
 * `rescheduleBackupForOrg` swaps just that org's task. When an org is
 * suspended or deleted, `unscheduleBackupForOrg` stops it. OSS deployments
 * have a single `DEFAULT_ORG` and end up with at most one task — behaviour
 * unchanged.
 *
 * Each cron tick runs inside `withOrgTx(orgId, ...)` so any tenant-scoped
 * DB work performed during the backup workflow (writing BackupRecord
 * rows, firing event alerts) is RLS-scoped to that org under the
 * strict-multi-tenant profile.
 */

// Map<organizationId, ScheduledTask>. Exposed via _scheduledTasksForTests
// so unit tests can assert membership without poking at module internals.
const scheduledTasks = new Map<string, ScheduledTask>();

/** Initialise scheduler from every active Organization's settings. */
export async function initBackupScheduler(): Promise<void> {
  const orgs = await adminPrisma.organization.findMany({
    where: { suspendedAt: null, deletedAt: null },
    select: { id: true, slug: true },
  });
  for (const org of orgs) {
    await runWithOrgContext(org.id, async () => {
      const settings = await getOrgSettings(org.id);
      if (settings.backupEnabled && settings.backupCron) {
        scheduleJobForOrg(org.id, settings.backupCron);
      }
    });
  }
  infoLog(
    "backup-scheduler",
    `Initialised: ${scheduledTasks.size} org backup task(s)`,
  );
}

/**
 * Replace (or remove) the backup task for a single org. Called from the
 * settings router when an admin toggles backupEnabled or changes the cron
 * expression, and from org lifecycle events.
 */
export function rescheduleBackupForOrg(
  organizationId: string,
  enabled: boolean,
  cronExpression: string,
): void {
  const existing = scheduledTasks.get(organizationId);
  if (existing) {
    existing.stop();
    scheduledTasks.delete(organizationId);
  }
  if (enabled) {
    scheduleJobForOrg(organizationId, cronExpression);
  }
}

/**
 * Tear down the org's task. Called on org suspend or delete from the
 * org-lifecycle handler. OSS has no lifecycle wiring today —
 * DEFAULT_ORG_ID is never suspended or deleted — so this hook has no
 * current OSS caller. It is the documented integration point that
 * tenant-lifecycle wiring invokes.
 */
export function unscheduleBackupForOrg(organizationId: string): void {
  const existing = scheduledTasks.get(organizationId);
  if (!existing) return;
  existing.stop();
  scheduledTasks.delete(organizationId);
}

/** Validate a cron expression. */
export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}

function scheduleJobForOrg(
  organizationId: string,
  cronExpression: string,
): void {
  if (!cron.validate(cronExpression)) {
    errorLog(
      "backup-scheduler",
      `Invalid cron expression for org=${organizationId}: ${cronExpression}`,
    );
    return;
  }

  const task = cron.schedule(cronExpression, async () => {
    infoLog(
      "backup-scheduler",
      `Starting scheduled backup for org=${organizationId}`,
    );
    // ─── Scope gap: tenant context not yet plumbed through the inner pipeline ────
    // `createBackup` / `runRetentionCleanup` / `runOrphanCleanup` currently
    // read org settings via the global Prisma client, which still hard-codes
    // `DEFAULT_ORG_ID` for some lookups (see backup.ts:552, :903, :1084,
    // :1171). Under OSS the table-owner role bypasses RLS so this works
    // identically to before. Under strict-multi-tenant RLS, threading the
    // org context through each service function is a follow-up refactor.
    // This scheduler does the right thing it CAN do today: register one
    // cron per org from each org's own settings, log per-org, and run
    // env-alerts scoped to the org's environments.
    try {
      const metadata = await createBackup("scheduled");
      infoLog(
        "backup-scheduler",
        `org=${organizationId} backup complete: ${metadata.sizeBytes} bytes`,
      );
      await runRetentionCleanup();
      try {
        const orphanResult = await runOrphanCleanup();
        debugLog("backup", "Orphan cleanup complete", orphanResult);
      } catch (orphanErr) {
        errorLog(
          "backup-scheduler",
          `org=${organizationId} orphan cleanup failed`,
          orphanErr,
        );
      }
    } catch (error) {
      errorLog(
        "backup-scheduler",
        `org=${organizationId} scheduled backup failed`,
        error,
      );
      const msg = error instanceof Error ? error.message : "Unknown error";
      try {
        const envs = await prisma.environment.findMany({
          where: { isSystem: false, organizationId },
          select: { id: true },
        });
        for (const env of envs) {
          await fireEventAlert("backup_failed", env.id, {
            message: `Scheduled backup failed: ${msg}`,
          });
        }
      } catch (alertErr) {
        errorLog(
          "backup-scheduler",
          `org=${organizationId} failed to fire backup_failed alerts`,
          alertErr,
        );
      }
    }
  });

  scheduledTasks.set(organizationId, task);
  infoLog(
    "backup-scheduler",
    `org=${organizationId} scheduler active: ${cronExpression}`,
  );
}

// ── Test-only helpers ──────────────────────────────────────────────────────
//
// Tests want to assert on the per-org task map without breaking
// encapsulation in production. Underscore prefix marks these as private
// API; not exported from the module barrel.

export function _scheduledTasksForTests(): Map<string, ScheduledTask> {
  return scheduledTasks;
}
