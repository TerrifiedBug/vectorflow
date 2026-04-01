import cron, { type ScheduledTask } from "node-cron";
import { debugLog, infoLog, errorLog } from "@/lib/logger";
import { runCostAnalysis } from "@/server/services/cost-optimizer";
import {
  storeRecommendations,
  cleanupExpiredRecommendations,
} from "@/server/services/cost-recommendations";
import { generateAiRecommendations } from "@/server/services/cost-optimizer-ai";

let scheduledTask: ScheduledTask | null = null;

// Default: run daily at 03:00 UTC
const DEFAULT_CRON = "0 3 * * *";

/** Initialize the cost optimizer background job. Called on server startup (leader-only). */
export async function initCostOptimizerScheduler(): Promise<void> {
  scheduleJob(DEFAULT_CRON);
  debugLog("cost-optimizer", "Scheduler initialized", { cron: DEFAULT_CRON });
}

/** Stop the scheduled job (for graceful shutdown). */
export function stopCostOptimizerScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

function scheduleJob(cronExpression: string): void {
  if (!cron.validate(cronExpression)) {
    errorLog("cost-optimizer", `Invalid cron expression: ${cronExpression}`);
    return;
  }

  scheduledTask = cron.schedule(cronExpression, async () => {
    infoLog("cost-optimizer", "Starting daily cost analysis...");
    try {
      await runDailyCostAnalysis();
    } catch (error) {
      errorLog("cost-optimizer", "Daily analysis failed", error);
    }
  });
  scheduledTask.start();

  infoLog("cost-optimizer", `Scheduler active: ${cronExpression}`);
}

/** Run the full daily analysis pipeline. Exported for manual triggering. */
export async function runDailyCostAnalysis(): Promise<{
  analysisCount: number;
  created: number;
  skipped: number;
  aiEnriched: number;
  expiredCleaned: number;
}> {
  // 1. Clean up expired recommendations
  const expiredCleaned = await cleanupExpiredRecommendations();

  // 2. Run cost analysis
  const results = await runCostAnalysis();

  // 3. Store recommendations
  const { created, skipped } = await storeRecommendations(results);

  // 4. Attempt AI enrichment for newly created recommendations
  let aiEnriched = 0;
  if (created > 0) {
    try {
      aiEnriched = await generateAiRecommendations();
    } catch (error) {
      errorLog("cost-optimizer", "AI enrichment failed (recommendations saved without AI summary)", error);
    }
  }

  const summary = {
    analysisCount: results.length,
    created,
    skipped,
    aiEnriched,
    expiredCleaned,
  };

  infoLog("cost-optimizer", "Daily analysis complete", summary);
  return summary;
}
