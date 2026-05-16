/**
 * Org data import — round-trip counterpart to `buildOrgDataExport`
 * (plan §18 / Phase 5cc).
 *
 * Takes an `OrgDataExportEnvelope` and recreates the structural,
 * customer-portability subset of its contents inside a NEW target
 * organisation. The output of `buildOrgDataExport(orgA, …)` fed back
 * through `importOrgData(envelope, { targetOrganizationId: orgB })`
 * yields an org B whose teams/environments/pipelines/pipeline-versions
 * /alert-rules/alert-channels/webhook-endpoints are structurally
 * identical to org A's — entity counts match, foreign-key topology is
 * preserved via an ID remap, and pipeline `nodes` / `edges` /
 * `globalConfig` JSON serialises byte-identically.
 *
 * Scope (intentionally narrow):
 *
 *   Imported:
 *     - teams                 (id remapped)
 *     - environments          (id remapped; teamId remapped)
 *     - pipelines             (id remapped; environmentId remapped)
 *     - pipelineVersions      (id remapped; pipelineId remapped)
 *     - alertRules            (id remapped; environmentId remapped)
 *     - notificationChannels  (id remapped; environmentId remapped)
 *     - webhookEndpoints      (id remapped; teamId remapped)
 *
 *   NOT imported (deliberate):
 *     - organization / organizationSettings — the target org row is the
 *       caller's responsibility. Settings copying is plan-tier work that
 *       lives outside the structural import path.
 *     - vectorNodes — agent state. A re-imported VectorNode would have
 *       no live agent backing it; agents must re-enroll against the new
 *       org's enrollment tokens.
 *     - auditLog — append-only history; replaying would corrupt the
 *       hash chain on the target org.
 *     - orgMembers / tenantUsers — user identities are platform-wide.
 *       The caller is responsible for inviting the right humans into
 *       the new org via the normal `OrgMember.create` flow.
 *     - orgAccessGrants — operator state, not customer-portable.
 *
 * Idempotency: NOT idempotent. Re-running the import without first
 * clearing the target org duplicates every row. The caller is
 * responsible for guaranteeing the target org is empty (Cloud signup
 * flow does this by construction).
 *
 * Security: the import runs against the caller's Prisma client; for
 * Cloud deployments that means passing the `tx` from `withOrgTx(orgB,
 * tx => importOrgData(env, { targetOrganizationId: orgB, client: tx }))`
 * so every INSERT is fenced by RLS and `app.org_id = orgB`. The
 * `organizationId` field on each inserted row is OVERWRITTEN with
 * `targetOrganizationId` — the source value from the envelope is
 * discarded.
 */
import type { PrismaClient } from "@/generated/prisma";
import type { OrgDataExportEnvelope } from "@/server/services/org-data-export";

type AnyRow = Record<string, unknown>;

export type OrgDataImportPrisma = Pick<
  PrismaClient,
  | "team"
  | "environment"
  | "pipeline"
  | "pipelineVersion"
  | "alertRule"
  | "notificationChannel"
  | "webhookEndpoint"
>;

export interface ImportOrgDataOpts {
  /** Prisma client. Pass the tx from `withOrgTx` for RLS-fenced inserts. */
  client?: OrgDataImportPrisma;
  /** Abort signal honoured between entity batches. */
  signal?: AbortSignal;
}

export interface ImportOrgDataResult {
  /** Counts of inserted rows per entity, for assertion in tests / UI. */
  counts: {
    teams: number;
    environments: number;
    pipelines: number;
    pipelineVersions: number;
    alertRules: number;
    notificationChannels: number;
    webhookEndpoints: number;
  };
  /** Source id → target id remaps, one per entity type. */
  remap: {
    teams: Record<string, string>;
    environments: Record<string, string>;
    pipelines: Record<string, string>;
    pipelineVersions: Record<string, string>;
    alertRules: Record<string, string>;
    notificationChannels: Record<string, string>;
    webhookEndpoints: Record<string, string>;
  };
}

function newId(prefix: string): string {
  // The cuid generator isn't available in test harness without dragging
  // in `@paralleldrive/cuid2`; new IDs only need to be unique within the
  // target org. A monotonic counter + entropy salt is enough.
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function checkpoint(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("importOrgData: aborted");
  }
}

/**
 * Strip fields that MUST be regenerated on the target side (timestamps,
 * id-derived columns, computed counters). Keeps everything else verbatim
 * so the round-trip preserves shape.
 */
function stripVolatile(row: AnyRow, keepKeys: ReadonlyArray<string> = []): AnyRow {
  const out: AnyRow = { ...row };
  for (const k of ["createdAt", "updatedAt"]) {
    if (!keepKeys.includes(k)) delete out[k];
  }
  return out;
}

export async function importOrgData(
  envelope: OrgDataExportEnvelope,
  targetOrganizationId: string,
  opts: ImportOrgDataOpts = {},
): Promise<ImportOrgDataResult> {
  if (!targetOrganizationId) {
    throw new Error("importOrgData: targetOrganizationId is required");
  }
  if (!envelope?.data) {
    throw new Error("importOrgData: envelope.data is missing");
  }
  const { data } = envelope;
  const db = opts.client;
  if (!db) {
    throw new Error(
      "importOrgData: a Prisma client must be supplied (use the tx from `withOrgTx(targetOrganizationId, ...)` for Cloud)",
    );
  }
  const signal = opts.signal;

  const remap: ImportOrgDataResult["remap"] = {
    teams: {},
    environments: {},
    pipelines: {},
    pipelineVersions: {},
    alertRules: {},
    notificationChannels: {},
    webhookEndpoints: {},
  };

  // ── teams ────────────────────────────────────────────────────────────
  checkpoint(signal);
  for (const row of data.teams) {
    const srcId = row.id as string;
    const newRowId = newId("team");
    remap.teams[srcId] = newRowId;
    await db.team.create({
      data: {
        ...stripVolatile(row),
        id: newRowId,
        organizationId: targetOrganizationId,
      } as never,
    });
  }

  // ── environments ─────────────────────────────────────────────────────
  checkpoint(signal);
  for (const row of data.environments) {
    const srcId = row.id as string;
    const newRowId = newId("env");
    remap.environments[srcId] = newRowId;
    const sourceTeamId = row.teamId as string | null;
    const remappedTeamId = sourceTeamId
      ? (remap.teams[sourceTeamId] ?? null)
      : null;
    await db.environment.create({
      data: {
        ...stripVolatile(row),
        id: newRowId,
        organizationId: targetOrganizationId,
        teamId: remappedTeamId,
      } as never,
    });
  }

  // ── pipelines ────────────────────────────────────────────────────────
  checkpoint(signal);
  for (const row of data.pipelines) {
    const srcId = row.id as string;
    const sourceEnvId = row.environmentId as string;
    const remappedEnvId = remap.environments[sourceEnvId];
    if (!remappedEnvId) {
      // Pipelines without a corresponding environment in the export are
      // orphans — skip them (and don't pollute the remap).
      continue;
    }
    const newRowId = newId("pipe");
    remap.pipelines[srcId] = newRowId;
    await db.pipeline.create({
      data: {
        ...stripVolatile(row),
        id: newRowId,
        organizationId: targetOrganizationId,
        environmentId: remappedEnvId,
      } as never,
    });
  }

  // ── pipelineVersions ────────────────────────────────────────────────
  checkpoint(signal);
  for (const row of data.pipelineVersions) {
    const srcId = row.id as string;
    const newRowId = newId("pv");
    remap.pipelineVersions[srcId] = newRowId;
    const sourcePipelineId = row.pipelineId as string;
    const remappedPipelineId = remap.pipelines[sourcePipelineId];
    if (!remappedPipelineId) continue;
    await db.pipelineVersion.create({
      data: {
        ...stripVolatile(row),
        id: newRowId,
        organizationId: targetOrganizationId,
        pipelineId: remappedPipelineId,
      } as never,
    });
  }

  // ── alertRules ───────────────────────────────────────────────────────
  checkpoint(signal);
  for (const row of data.alertRules) {
    const srcId = row.id as string;
    const newRowId = newId("ar");
    remap.alertRules[srcId] = newRowId;
    const sourceEnvId = row.environmentId as string | null;
    const remappedEnvId = sourceEnvId
      ? (remap.environments[sourceEnvId] ?? null)
      : null;
    await db.alertRule.create({
      data: {
        ...stripVolatile(row),
        id: newRowId,
        organizationId: targetOrganizationId,
        environmentId: remappedEnvId,
      } as never,
    });
  }

  // ── notificationChannels ────────────────────────────────────────────
  checkpoint(signal);
  for (const row of data.alertChannels) {
    const srcId = row.id as string;
    const newRowId = newId("nc");
    remap.notificationChannels[srcId] = newRowId;
    const sourceEnvId = row.environmentId as string | null;
    const remappedEnvId = sourceEnvId
      ? (remap.environments[sourceEnvId] ?? null)
      : null;
    await db.notificationChannel.create({
      data: {
        ...stripVolatile(row),
        id: newRowId,
        organizationId: targetOrganizationId,
        environmentId: remappedEnvId,
      } as never,
    });
  }

  // ── webhookEndpoints ────────────────────────────────────────────────
  checkpoint(signal);
  for (const row of data.webhookEndpoints) {
    const srcId = row.id as string;
    const newRowId = newId("wh");
    remap.webhookEndpoints[srcId] = newRowId;
    const sourceTeamId = row.teamId as string | null;
    const remappedTeamId = sourceTeamId
      ? (remap.teams[sourceTeamId] ?? null)
      : null;
    await db.webhookEndpoint.create({
      data: {
        ...stripVolatile(row),
        id: newRowId,
        organizationId: targetOrganizationId,
        teamId: remappedTeamId,
      } as never,
    });
  }

  return {
    counts: {
      teams: Object.keys(remap.teams).length,
      environments: Object.keys(remap.environments).length,
      pipelines: Object.keys(remap.pipelines).length,
      pipelineVersions: Object.keys(remap.pipelineVersions).length,
      alertRules: Object.keys(remap.alertRules).length,
      notificationChannels: Object.keys(remap.notificationChannels).length,
      webhookEndpoints: Object.keys(remap.webhookEndpoints).length,
    },
    remap,
  };
}
