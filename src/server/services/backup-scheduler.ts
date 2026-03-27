import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "@/lib/prisma";
import { createBackup, runRetentionCleanup } from "./backup";
import { fireEventAlert } from "./event-alerts";

let scheduledTask: ScheduledTask | null = null;

/** Initialize the backup scheduler from SystemSettings. Called on server startup. */
export async function initBackupScheduler(): Promise<void> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { backupEnabled: true, backupCron: true },
  });

  if (settings?.backupEnabled && settings.backupCron) {
    scheduleJob(settings.backupCron);
  }
}

/** Reschedule the backup job. Called when settings are updated via the UI. */
export function rescheduleBackup(enabled: boolean, cronExpression: string): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  if (enabled) {
    scheduleJob(cronExpression);
  }
}

/** Validate a cron expression. */
export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}

function scheduleJob(cronExpression: string): void {
  if (!cron.validate(cronExpression)) {
    console.error(`[backup] Invalid cron expression: ${cronExpression}`);
    return;
  }

  scheduledTask = cron.schedule(cronExpression, async () => {
    console.log("[backup] Starting scheduled backup...");
    try {
      const metadata = await createBackup("scheduled");
      console.log(`[backup] Scheduled backup complete: ${metadata.sizeBytes} bytes`);
      await runRetentionCleanup();
    } catch (error) {
      console.error("[backup] Scheduled backup failed:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      // Fire backup_failed alert for all environments (properly awaited -- RELY-01)
      try {
        const envs = await prisma.environment.findMany({
          where: { isSystem: false },
          select: { id: true },
        });
        for (const env of envs) {
          await fireEventAlert("backup_failed", env.id, {
            message: `Scheduled backup failed: ${msg}`,
          });
        }
      } catch (alertErr) {
        console.error("[backup] Failed to fire backup_failed alerts:", alertErr);
      }
    }
  });

  console.log(`[backup] Scheduler active: ${cronExpression}`);
}
