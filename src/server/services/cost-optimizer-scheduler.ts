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
import { isLeader } from "@/server/services/leader-election";

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
let continuousTask: ScheduledTask | null = null;

// Default: full pass (cleanup + analysis + store + AI enrichment) daily at 03:00 UTC.
const DEFAULT_CRON = "0 3 * * *";

// Continuous pass: a lighter analysis + store (no AI enrichment, no expiry
// cleanup) every 30 min so recommendations track fresh metrics within the day
// rather than only nightly. Dedup in `storeRecommendations` keeps it idempotent
// (no duplicate-rec spam). Override or disable via COST_OPTIMIZER_CONTINUOUS_CRON
// (set to "" to disable the continuous pass entirely).
const DEFAULT_CONTINUOUS_CRON = "*/30 * * * *";

function resolveContinuousCron(): string | null {
  const raw = process.env.COST_OPTIMIZER_CONTINUOUS_CRON;
  if (raw === undefined) return DEFAULT_CONTINUOUS_CRON;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Initialise the cost-optimizer background jobs. Called on server startup (leader-only). */
export async function initCostOptimizerScheduler(): Promise<void> {
  scheduledTask = scheduleJob(
    DEFAULT_CRON,
    "daily cost analysis (fleet fan-out)",
    runDailyCostAnalysisAllOrgs,
  );

  const continuousCron = resolveContinuousCron();
  if (continuousCron) {
    continuousTask = scheduleJob(
      continuousCron,
      "continuous cost analysis (fleet fan-out)",
      runContinuousCostAnalysisAllOrgs,
    );
  }

  debugLog("cost-optimizer", "Scheduler initialised", {
    cron: DEFAULT_CRON,
    continuousCron: continuousCron ?? "disabled",
  });
}

/** Stop the scheduled jobs (graceful shutdown). */
export function stopCostOptimizerScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  if (continuousTask) {
    continuousTask.stop();
    continuousTask = null;
  }
}

function scheduleJob(
  cronExpression: string,
  label: string,
  run: () => Promise<void>,
): ScheduledTask | null {
  if (!cron.validate(cronExpression)) {
    errorLog("cost-optimizer", `Invalid cron expression for ${label}: ${cronExpression}`);
    return null;
  }

  const task = cron.schedule(cronExpression, async () => {
    // SC-3: both the daily and continuous passes route through this callback.
    // A demoted leader's cron tasks keep firing for up to one TTL (~15s) after
    // Redis renewals fail, so re-check leadership here — a demoted instance
    // skips the run instead of racing the new leader (duplicate analysis runs).
    // Guard only — the cron task is left registered.
    if (!isLeader()) {
      debugLog("cost-optimizer", `Skipping ${label} — instance is no longer leader`);
      return;
    }
    infoLog("cost-optimizer", `Starting ${label}...`);
    try {
      await run();
    } catch (error) {
      errorLog("cost-optimizer", `${label} failed`, error);
    }
  });

  infoLog("cost-optimizer", `Scheduler active: ${label} (${cronExpression})`);
  return task;
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

/**
 * Fleet fan-out of the lighter continuous pass. Errors are isolated per-org so a
 * failure on one tenant does not stall the rest.
 */
export async function runContinuousCostAnalysisAllOrgs(): Promise<void> {
  const orgs = await adminPrisma.organization.findMany({
    where: { suspendedAt: null, deletedAt: null },
    select: { id: true },
  });
  for (const org of orgs) {
    try {
      await runWithOrgContext(org.id, () =>
        runContinuousCostAnalysisForOrg(org.id),
      );
    } catch (err) {
      errorLog(
        "cost-optimizer",
        `org=${org.id} continuous analysis failed (continuing with remaining orgs)`,
        err,
      );
    }
  }
}

/**
 * Lightweight continuous pass for one org: re-run the analysis and store any new
 * recommendations. Skips AI enrichment and expiry cleanup (the nightly pass owns
 * those) so it stays cheap to run every 30 min. Idempotent —
 * `storeRecommendations` dedupes against existing PENDING recommendations of the
 * same (pipeline, type), so repeated runs never spam duplicates.
 */
export async function runContinuousCostAnalysisForOrg(
  organizationId: string,
): Promise<{ analysisCount: number; created: number; skipped: number }> {
  const results = await runCostAnalysis();
  const { created, skipped } = await storeRecommendations(results);
  const summary = { analysisCount: results.length, created, skipped };
  debugLog(
    "cost-optimizer",
    `org=${organizationId} continuous analysis complete`,
    summary,
  );
  return summary;
}


