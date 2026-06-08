import { prisma } from "@/lib/prisma";
import {
  evaluateSliOverWindow,
  rollUpSliStatus,
  type SliResult,
  type SliStatus,
} from "@/server/services/sli-evaluator";

/**
 * Replay-driven promotion validation (NF-6).
 *
 * A replay re-injects a bounded, immutable sample of past lake events into a
 * candidate pipeline (the canary). This module scores how the candidate
 * behaved *over exactly that sample* against the pipeline's own SLIs, so a
 * promotion can be gated on a real "prove the new config is safe" signal
 * rather than a deploy-and-pray rollout.
 *
 * The score reuses the pipeline's configured `PipelineSli` thresholds as the
 * error budget — there is no second, parallel notion of "acceptable" — but
 * evaluates them strictly over the replay's `[startedAt, completedAt]` window
 * (via {@link evaluateSliOverWindow}) instead of a rolling trailing window.
 */

/** PASS = every scored SLI met; FAIL = at least one breached; NO_DATA = nothing
 *  scorable (no replay window, no applicable SLIs, or no metrics in window). */
export type ReplayVerdict = "PASS" | "FAIL" | "NO_DATA";

export interface ReplayValidationResult {
  verdict: ReplayVerdict;
  /** Per-SLI breakdown (empty when there was nothing to score). */
  slis: SliResult[];
  /** The replay window the SLIs were scored over, or null when absent. */
  window: { from: string; to: string } | null;
}

/**
 * SLI metrics meaningful to score over a bounded replay sample.
 *
 * `throughput_floor` is deliberately excluded: it is a time-rate gate, and a
 * replay's wall-clock duration is an artifact of the agent's polling cadence,
 * not of real traffic — so events/second over a replay window carries no
 * signal. `error_rate` / `discard_rate` are ratios and `latency_mean` an
 * average; all three are independent of the window's duration.
 */
export const REPLAY_GATED_METRICS = ["error_rate", "discard_rate", "latency_mean"] as const;

const VERDICT_BY_STATUS: Record<SliStatus, ReplayVerdict> = {
  healthy: "PASS",
  degraded: "FAIL",
  no_data: "NO_DATA",
};

/**
 * Score a completed replay against its target pipeline's SLIs.
 *
 * Returns `NO_DATA` (never a spurious PASS/FAIL) when the replay has no
 * window yet, the target has no replay-applicable SLIs, or no metrics landed
 * in the window — a gate built on this result must treat `NO_DATA` as
 * "no opinion", not as approval.
 */
export async function evaluateReplayValidation(args: {
  targetPipelineId: string;
  startedAt: Date | null;
  completedAt: Date | null;
}): Promise<ReplayValidationResult> {
  const { targetPipelineId, startedAt, completedAt } = args;

  // A replay only carries signal once it has actually run a window of events.
  if (!startedAt || !completedAt) {
    return { verdict: "NO_DATA", slis: [], window: null };
  }

  const sliDefs = await prisma.pipelineSli.findMany({
    where: {
      pipelineId: targetPipelineId,
      enabled: true,
      metric: { in: [...REPLAY_GATED_METRICS] },
    },
  });

  const slis: SliResult[] = [];
  for (const sli of sliDefs) {
    slis.push(await evaluateSliOverWindow(targetPipelineId, sli, startedAt, completedAt));
  }

  return {
    verdict: VERDICT_BY_STATUS[rollUpSliStatus(slis)],
    slis,
    window: { from: startedAt.toISOString(), to: completedAt.toISOString() },
  };
}
