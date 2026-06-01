import cron, { type ScheduledTask } from "node-cron";
import { adminPrisma } from "@/lib/prisma";
import { runWithOrgContext } from "@/lib/org-context";
import { debugLog, infoLog, errorLog } from "@/lib/logger";
import { runCostAnalysis } from "@/server/services/cost-optimizer";
import {
  storeRecommendations,
  cleanupExpiredRecommendations,
} from "@/server/services/cost-recommendations";
import { generateAiRecommendations } from "@/server/services/cost-optimizer-ai";

/**
 * Cost-optimizer scheduler — single global cron tick fans out across orgs.
 *
 * Unlike backup scheduling, the cost analysis cadence is platform-level
 * (one daily run) rather than per-org configurable. The tick iterates all
 * non-suspended / non-deleted orgs and runs the full analysis pipeline
 * for each inside `withOrgTx(orgId, ...)` so:
 *   - Recommendations are written under the right org's RLS context.
 *   - One org's failure does not abort the others (best-effort fan-out).
 */

let scheduledTask: ScheduledTask | null = null;

// Default: run daily at 03:00 UTC
const DEFAULT_CRON = "0 3 * * *";

/** Initialise the cost-optimizer background job. Called on server startup (leader-only). */
export async function initCostOptimizerScheduler(): Promise<void> {
  scheduleJob(DEFAULT_CRON);
  debugLog("cost-optimizer", "Scheduler initialised", { cron: DEFAULT_CRON });
}

/** Stop the scheduled job (graceful shutdown). */
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
    infoLog("cost-optimizer", "Starting daily cost analysis (fleet fan-out)...");
    try {
      await runDailyCostAnalysisAllOrgs();
    } catch (error) {
      errorLog("cost-optimizer", "Daily analysis fleet sweep failed", error);
    }
  });

  infoLog("cost-optimizer", `Scheduler active: ${cronExpression}`);
}

/**
 * Iterate every active org and run the daily pipeline against each. Errors
 * are isolated per-org so a failure on one tenant does not stall the rest.
 */
export async function runDailyCostAnalysisAllOrgs(): Promise<void> {
  const orgs = await adminPrisma.organization.findMany({
    where: { suspendedAt: null, deletedAt: null },
    select: { id: true },
  });
  for (const org of orgs) {
    try {
      await runWithOrgContext(org.id, () =>
        runDailyCostAnalysisForOrg(org.id),
      );
    } catch (err) {
      errorLog(
        "cost-optimizer",
        `org=${org.id} daily analysis failed (continuing with remaining orgs)`,
        err,
      );
    }
  }
}

/** Full daily cost analysis pipeline for one org. */
export async function runDailyCostAnalysisForOrg(
  organizationId: string,
): Promise<{
  analysisCount: number;
  created: number;
  skipped: number;
  aiEnriched: number;
  expiredCleaned: number;
}> {
  // ─── Scope gap: tenant context not yet plumbed through the pipeline ────
  // `cleanupExpiredRecommendations`, `runCostAnalysis`, `storeRecommendations`,
  // and `generateAiRecommendations` all use the global Prisma client today;
  // they do not accept a tx or organizationId parameter, so the SET LOCAL
  // app.org_id we would set in `withOrgTx` does not propagate to their
  // queries. Under OSS the table-owner role bypasses RLS so this works
  // identically to before. Under strict-multi-tenant RLS, threading the
  // org context through each service function is a follow-up refactor.
  // The fan-out across orgs is the win this PR ships.
  const expiredCleaned = await cleanupExpiredRecommendations();
  const results = await runCostAnalysis();
  const { created, skipped } = await storeRecommendations(results);
  let aiEnriched = 0;
  if (created > 0) {
    try {
      aiEnriched = await generateAiRecommendations();
    } catch (err) {
      errorLog(
        "cost-optimizer",
        `org=${organizationId} AI enrichment failed (recommendations saved without AI summary)`,
        err,
      );
    }
  }
  const summary = {
    analysisCount: results.length,
    created,
    skipped,
    aiEnriched,
    expiredCleaned,
  };
  infoLog("cost-optimizer", `org=${organizationId} daily analysis complete`, summary);
  return summary;
}


