// src/server/services/incident-copilot.ts
//
// Incident copilot correlation core (B2 agentic AI).
//
// Given a recent timeline of AnomalyEvents and Releases for a pipeline/
// environment, decide whether a recent release plausibly *caused* an anomaly —
// i.e. its deploy time precedes the anomaly onset within a suspicion window —
// and, if so, propose a human-approved rollback action. This module is pure:
// it takes plain arrays and returns a structured proposal, so it is trivially
// unit-testable and never auto-applies anything. The router (proposed-change)
// loads the data, gates on the team's BYO AI key, and surfaces this proposal;
// the actual rollback is a separate, audited, human-clicked mutation.

import type { ReleaseStrategy } from "@/generated/prisma";
import { CORRELATION_WINDOW_MS } from "@/server/services/alert-correlator";

/**
 * How long after a deploy an anomaly is still considered "plausibly caused" by
 * that release. Releases surface throughput/error/latency anomalies over a
 * longer horizon than alerts cluster, so we widen the alert-correlation window
 * (reusing it ties the copilot to the same incident-correlation concept).
 */
export const RELEASE_SUSPECT_WINDOW_MS = 6 * CORRELATION_WINDOW_MS; // 30 minutes

/** Release statuses that represent an actually-shipped change (a deploy event). */
const DEPLOYED_STATUSES: Record<string, true> = {
  DEPLOYED: true,
  DEPLOYING: true,
  CANARY_DEPLOYED: true,
  HEALTH_CHECK: true,
  BROADENED: true,
};

export interface CopilotAnomaly {
  id: string;
  pipelineId: string;
  environmentId: string;
  metricName: string;
  severity: string;
  message: string;
  status: string;
  detectedAt: Date;
}

export interface CopilotRelease {
  id: string;
  strategy: ReleaseStrategy;
  status: string;
  pipelineId: string;
  environmentId: string;
  changelog: string;
  deployedAt: Date | null;
  createdAt: Date;
}

export type IncidentAction =
  | {
      type: "rollback";
      releaseId: string;
      strategy: ReleaseStrategy;
      pipelineId: string;
      environmentId: string;
      anomalyId: string;
    }
  | { type: "none" };

export interface IncidentProposal {
  summary: string;
  suggestedAction: IncidentAction;
  /** The anomaly that anchored the correlation (null when no rollback proposed). */
  correlatedAnomaly: CopilotAnomaly | null;
  /** The release blamed for the anomaly (null when no rollback proposed). */
  correlatedRelease: CopilotRelease | null;
}

/**
 * Correlate anomalies against releases and propose a rollback when a release
 * deployed shortly *before* an anomaly onset on the same pipeline.
 *
 * Walks anomalies most-recent-first (newest incident is the most actionable),
 * and for each finds the closest preceding release inside `windowMs`. The
 * first match wins. Returns `{ type: "none" }` when nothing lines up — never
 * fabricates a culprit.
 */
export function correlateIncident(args: {
  anomalies: CopilotAnomaly[];
  releases: CopilotRelease[];
  windowMs?: number;
}): IncidentProposal {
  const windowMs = args.windowMs ?? RELEASE_SUSPECT_WINDOW_MS;

  const anomalies = [...args.anomalies].sort(
    (a, b) => b.detectedAt.getTime() - a.detectedAt.getTime(),
  );

  for (const anomaly of anomalies) {
    const onset = anomaly.detectedAt.getTime();

    const candidate = args.releases
      .filter(
        (r) =>
          r.pipelineId === anomaly.pipelineId &&
          (DEPLOYED_STATUSES[r.status] || r.deployedAt != null),
      )
      .map((r) => ({
        release: r,
        at: (r.deployedAt ?? r.createdAt).getTime(),
      }))
      .filter(({ at }) => at <= onset && onset - at <= windowMs)
      // closest preceding deploy is the prime suspect
      .sort((a, b) => b.at - a.at)[0];

    if (candidate) {
      const minutesBefore = Math.max(
        0,
        Math.round((onset - candidate.at) / 60_000),
      );
      const rel = candidate.release;
      return {
        summary:
          `Release ${rel.id} (${rel.strategy.toLowerCase()}) deployed ${minutesBefore} min ` +
          `before a ${anomaly.severity.toLowerCase()} "${anomaly.metricName}" anomaly on this ` +
          `pipeline — "${anomaly.message}". The deploy likely caused the regression; roll back ` +
          `to the previous version to confirm.`,
        suggestedAction: {
          type: "rollback",
          releaseId: rel.id,
          strategy: rel.strategy,
          pipelineId: rel.pipelineId,
          environmentId: rel.environmentId,
          anomalyId: anomaly.id,
        },
        correlatedAnomaly: anomaly,
        correlatedRelease: rel,
      };
    }
  }

  return {
    summary:
      anomalies.length === 0
        ? "No recent anomalies detected — nothing to correlate."
        : "Recent anomalies are not temporally linked to a recent release; no rollback suggested.",
    suggestedAction: { type: "none" },
    correlatedAnomaly: null,
    correlatedRelease: null,
  };
}
