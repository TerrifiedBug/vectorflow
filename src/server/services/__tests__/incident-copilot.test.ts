import { vi, describe, it, expect } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// incident-copilot imports alert-correlator, which imports the prisma client.
// correlateIncident itself is pure, but mock prisma so the import chain stays
// inert and fast.
vi.mock("@/lib/prisma", () => {
  const pm = mockDeep<PrismaClient>();
  return { prisma: pm, basePrisma: pm, adminPrisma: pm };
});

import {
  correlateIncident,
  RELEASE_SUSPECT_WINDOW_MS,
  type CopilotAnomaly,
  type CopilotRelease,
} from "@/server/services/incident-copilot";

const ONSET = new Date("2026-03-01T12:00:00Z");

function anomaly(overrides: Partial<CopilotAnomaly> = {}): CopilotAnomaly {
  return {
    id: "anom-1",
    pipelineId: "pipe-1",
    environmentId: "env-1",
    metricName: "eventsIn",
    severity: "critical",
    message: "throughput dropped 80%",
    status: "open",
    detectedAt: ONSET,
    ...overrides,
  };
}

function release(overrides: Partial<CopilotRelease> = {}): CopilotRelease {
  return {
    id: "rel-1",
    strategy: "DIRECT",
    status: "DEPLOYED",
    pipelineId: "pipe-1",
    environmentId: "env-1",
    changelog: "ship it",
    deployedAt: new Date(ONSET.getTime() - 10 * 60_000), // 10 min before onset
    createdAt: new Date(ONSET.getTime() - 11 * 60_000),
    ...overrides,
  };
}

describe("correlateIncident", () => {
  it("proposes a rollback when a release deployed shortly before an anomaly onset", () => {
    const result = correlateIncident({ anomalies: [anomaly()], releases: [release()] });

    expect(result.suggestedAction).toEqual({
      type: "rollback",
      releaseId: "rel-1",
      strategy: "DIRECT",
      pipelineId: "pipe-1",
      environmentId: "env-1",
      anomalyId: "anom-1",
    });
    expect(result.correlatedRelease?.id).toBe("rel-1");
    expect(result.correlatedAnomaly?.id).toBe("anom-1");
    expect(result.summary).toContain("10 min");
  });

  it("returns no action when there are no anomalies", () => {
    const result = correlateIncident({ anomalies: [], releases: [release()] });
    expect(result.suggestedAction).toEqual({ type: "none" });
    expect(result.correlatedRelease).toBeNull();
    expect(result.summary).toContain("No recent anomalies");
  });

  it("returns no action when the release deployed AFTER the anomaly onset", () => {
    const result = correlateIncident({
      anomalies: [anomaly()],
      releases: [release({ deployedAt: new Date(ONSET.getTime() + 60_000), createdAt: new Date(ONSET.getTime() + 60_000) })],
    });
    expect(result.suggestedAction).toEqual({ type: "none" });
  });

  it("returns no action when the release is outside the suspicion window", () => {
    const tooOld = new Date(ONSET.getTime() - (RELEASE_SUSPECT_WINDOW_MS + 60_000));
    const result = correlateIncident({
      anomalies: [anomaly()],
      releases: [release({ deployedAt: tooOld, createdAt: tooOld })],
    });
    expect(result.suggestedAction).toEqual({ type: "none" });
    expect(result.summary).toContain("not temporally linked");
  });

  it("ignores releases on a different pipeline", () => {
    const result = correlateIncident({
      anomalies: [anomaly({ pipelineId: "pipe-1" })],
      releases: [release({ id: "rel-other", pipelineId: "pipe-2" })],
    });
    expect(result.suggestedAction).toEqual({ type: "none" });
  });

  it("picks the closest preceding release when several qualify", () => {
    const closest = release({
      id: "rel-closest",
      deployedAt: new Date(ONSET.getTime() - 2 * 60_000),
      createdAt: new Date(ONSET.getTime() - 3 * 60_000),
    });
    const farther = release({
      id: "rel-farther",
      deployedAt: new Date(ONSET.getTime() - 20 * 60_000),
      createdAt: new Date(ONSET.getTime() - 21 * 60_000),
    });
    const result = correlateIncident({ anomalies: [anomaly()], releases: [farther, closest] });
    expect(result.suggestedAction).toMatchObject({ type: "rollback", releaseId: "rel-closest" });
  });

  it("falls back to createdAt when deployedAt is null (e.g. canary)", () => {
    const result = correlateIncident({
      anomalies: [anomaly()],
      releases: [
        release({
          id: "rel-canary",
          strategy: "CANARY",
          status: "CANARY_DEPLOYED",
          deployedAt: null,
          createdAt: new Date(ONSET.getTime() - 5 * 60_000),
        }),
      ],
    });
    expect(result.suggestedAction).toMatchObject({
      type: "rollback",
      releaseId: "rel-canary",
      strategy: "CANARY",
    });
  });

  it("ignores releases that never deployed (non-deploy status, no deployedAt)", () => {
    const result = correlateIncident({
      anomalies: [anomaly()],
      releases: [
        release({
          id: "rel-pending",
          status: "PENDING",
          deployedAt: null,
          createdAt: new Date(ONSET.getTime() - 5 * 60_000),
        }),
      ],
    });
    expect(result.suggestedAction).toEqual({ type: "none" });
  });

  it("anchors on the most recent anomaly that has a culprit release", () => {
    const olderAnom = anomaly({
      id: "anom-old",
      detectedAt: new Date(ONSET.getTime() - 60 * 60_000),
    });
    const newerAnom = anomaly({ id: "anom-new", detectedAt: ONSET });
    const culprit = release({
      id: "rel-new",
      deployedAt: new Date(ONSET.getTime() - 3 * 60_000),
      createdAt: new Date(ONSET.getTime() - 4 * 60_000),
    });
    const result = correlateIncident({
      anomalies: [olderAnom, newerAnom],
      releases: [culprit],
    });
    expect(result.suggestedAction).toMatchObject({ anomalyId: "anom-new", releaseId: "rel-new" });
  });
});
