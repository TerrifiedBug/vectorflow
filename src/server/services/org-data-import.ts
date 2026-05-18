/**
 * Org data import — round-trip counterpart to `buildOrgDataExport`
 *.
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
 * responsible for guaranteeing the target org is empty (a multi-tenant signup
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
  | "alertRuleChannel"
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
    alertRuleChannels: number;
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
 * Strip fields that MUST be regenerated on the target side AND drop the
 * `__has_<key>: bool` presence markers that `buildOrgDataExport` writes
 * in place of redacted sensitive columns. Prisma rejects unknown args
 * with `Unknown arg`, so any `__has_*` left in the data object would
 * abort the create.
 *
 * Callers can keep specific timestamps via `keepKeys` (e.g. preserve
 * `createdAt` for audit log roundtrips); the `__has_*` markers are
 * always dropped because they're not real columns.
 */
function stripVolatile(row: AnyRow, keepKeys: ReadonlyArray<string> = []): AnyRow {
  const out: AnyRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("__has_")) continue;
    if (k === "createdAt" || k === "updatedAt") {
      if (!keepKeys.includes(k)) continue;
    }
    out[k] = v;
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
  // Codex P2 on the initial PR: the remap entry was recorded BEFORE
  // the parent-pipeline check, so orphan versions inflated `counts` and
  // the `result.remap` exposed IDs that were never inserted. Reorder:
  // remap only after the FK guard.
  checkpoint(signal);
  for (const row of data.pipelineVersions) {
    const srcId = row.id as string;
    const sourcePipelineId = row.pipelineId as string;
    const remappedPipelineId = remap.pipelines[sourcePipelineId];
    if (!remappedPipelineId) continue;
    const newRowId = newId("pv");
    remap.pipelineVersions[srcId] = newRowId;
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
  // AlertRule has THREE foreign keys that need remapping:
  //   - environmentId (required)
  //   - teamId        (required)
  //   - pipelineId    (optional)
  // The export spreads all three; the import MUST rewrite each to the
  // target-side id or skip the row to avoid an FK violation.
  checkpoint(signal);
  for (const row of data.alertRules) {
    const srcId = row.id as string;
    const sourceEnvId = row.environmentId as string | null;
    const remappedEnvId = sourceEnvId
      ? (remap.environments[sourceEnvId] ?? null)
      : null;
    const sourceTeamId = row.teamId as string | null;
    const remappedTeamId = sourceTeamId
      ? (remap.teams[sourceTeamId] ?? null)
      : null;
    if (!remappedEnvId || !remappedTeamId) continue;
    const sourcePipelineId = row.pipelineId as string | null;
    const remappedPipelineId = sourcePipelineId
      ? (remap.pipelines[sourcePipelineId] ?? null)
      : null;
    const newRowId = newId("ar");
    remap.alertRules[srcId] = newRowId;
    await db.alertRule.create({
      data: {
        ...stripVolatile(row),
        id: newRowId,
        organizationId: targetOrganizationId,
        environmentId: remappedEnvId,
        teamId: remappedTeamId,
        pipelineId: remappedPipelineId,
      } as never,
    });
  }

  // ── notificationChannels ────────────────────────────────────────────
  // `NotificationChannel.config` is REDACTED in the export (presence flag
  // only, no plaintext credentials). Prisma marks `config` as required,
  // so we MUST supply a value at import time. We default to `{}` and
  // surface it as a placeholder: the target-side admin re-enters Slack
  // tokens / PagerDuty integration keys / webhook URLs through the UI.
  // Without this default the create would fail validation and the entire
  // round-trip would abort.
  checkpoint(signal);
  for (const row of data.alertChannels) {
    const srcId = row.id as string;
    const sourceEnvId = row.environmentId as string | null;
    const remappedEnvId = sourceEnvId
      ? (remap.environments[sourceEnvId] ?? null)
      : null;
    if (!remappedEnvId) continue;
    const newRowId = newId("nc");
    remap.notificationChannels[srcId] = newRowId;
    // If `config` survived the export (e.g. operator re-injected it after
    // redaction), use it; otherwise default to `{}` so Prisma accepts.
    const config =
      (row.config && typeof row.config === "object") ? row.config : {};
    await db.notificationChannel.create({
      data: {
        ...stripVolatile(row),
        id: newRowId,
        organizationId: targetOrganizationId,
        environmentId: remappedEnvId,
        config,
      } as never,
    });
  }

  // ── alertRuleChannels (join table) ───────────────────────────────────
  // Restore the per-rule channel routing. Without these rows, runtime
  // delivery in `src/server/services/channels/index.ts` falls back to
  // broadcasting to every enabled channel in the environment — alerts
  // end up at unintended destinations after import.
  //
  // Defensive: envelopes from older exports (pre-Phase-5cc) won't have
  // this field. Treat a missing array as "nothing to restore" rather
  // than failing the import.
  let alertRuleChannelInserts = 0;
  const sourceLinks = (data as { alertRuleChannels?: AnyRow[] }).alertRuleChannels ?? [];
  checkpoint(signal);
  for (const row of sourceLinks) {
    const sourceAlertRuleId = row.alertRuleId as string;
    const sourceChannelId = row.channelId as string;
    const remappedAlertRuleId = remap.alertRules[sourceAlertRuleId];
    const remappedChannelId = remap.notificationChannels[sourceChannelId];
    if (!remappedAlertRuleId || !remappedChannelId) continue;
    await db.alertRuleChannel.create({
      data: {
        ...stripVolatile(row),
        id: newId("arc"),
        alertRuleId: remappedAlertRuleId,
        channelId: remappedChannelId,
      } as never,
    });
    alertRuleChannelInserts++;
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
      alertRuleChannels: alertRuleChannelInserts,
    },
    remap,
  };
}
