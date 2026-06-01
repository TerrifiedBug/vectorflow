/**
 * Org data export → import round-trip.
 *
 * Loads a deterministic fixture into the export-side Prisma mock, runs
 * `buildOrgDataExport(orgA)`, replays the resulting envelope into a
 * separate import-side mock as `importOrgData(env, { targetOrganizationId: orgB })`,
 * and verifies that:
 *
 *   1. Entity counts match per type (teams, environments, pipelines,
 *      pipelineVersions, alertRules, notificationChannels, webhookEndpoints).
 *   2. Pipeline JSON columns (`globalConfig`, `nodes`, `edges`) survive
 *      byte-identically through the round-trip.
 *   3. FK topology is preserved through the ID remap: org B's pipeline
 *      points at org B's environment, which points at org B's team.
 *   4. Source `organizationId` is replaced with the target on every row.
 *   5. Orphan pipelines (whose environment isn't in the export) are
 *      skipped rather than violating the FK.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import { prisma } from "@/lib/prisma";
import { buildOrgDataExport } from "@/server/services/org-data-export";
import {
  importOrgData,
  type OrgDataImportPrisma,
} from "@/server/services/org-data-import";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const SOURCE_ORG_ID = "org-A";
const TARGET_ORG_ID = "org-B";
const NOW = new Date("2026-05-16T10:00:00Z");

const teamA = {
  id: "team-A1",
  organizationId: SOURCE_ORG_ID,
  name: "Eng",
  aiApiKey: "enc:secret",
  createdAt: NOW,
  updatedAt: NOW,
};

const envA = {
  id: "env-A1",
  organizationId: SOURCE_ORG_ID,
  teamId: "team-A1",
  name: "production",
  gitToken: "enc:gittoken",
  gitWebhookSecret: "enc:gh-secret",
  enrollmentTokenHash: "hash",
  secretBackendConfig: { type: "vault" },
  createdAt: NOW,
  updatedAt: NOW,
};

const pipelineA = {
  id: "pipe-A1",
  organizationId: SOURCE_ORG_ID,
  environmentId: "env-A1",
  name: "syslog-to-clickhouse",
  globalConfig: { log_level: "info", buffer_max_size: 268_435_456 },
  nodes: [
    {
      componentKey: "syslog_in",
      componentType: "syslog",
      kind: "SOURCE",
      config: { address: "0.0.0.0:514" },
    },
    {
      componentKey: "out",
      componentType: "clickhouse",
      kind: "SINK",
      config: { endpoint: "https://ch.example/" },
    },
  ],
  edges: [{ from: "syslog_in", to: "out" }],
  createdAt: NOW,
  updatedAt: NOW,
};

const pipelineVersionA = {
  id: "pv-A1",
  organizationId: SOURCE_ORG_ID,
  pipelineId: "pipe-A1",
  version: 1,
  config: "sources:\n  syslog_in:\n    type: syslog",
  createdAt: NOW,
};

const alertRuleA = {
  id: "ar-A1",
  organizationId: SOURCE_ORG_ID,
  environmentId: "env-A1",
  teamId: "team-A1",
  pipelineId: "pipe-A1",
  name: "errors-spike",
  metric: "errorsTotal",
  threshold: 100,
};

const notificationChannelA = {
  id: "ch-A1",
  organizationId: SOURCE_ORG_ID,
  environmentId: "env-A1",
  name: "ops-slack",
  type: "slack",
  config: { url: "https://hooks.slack.com/services/AAA/BBB" },
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const webhookEndpointA = {
  id: "wh-A1",
  organizationId: SOURCE_ORG_ID,
  teamId: "team-A1",
  name: "ext-hook",
  url: "https://customer.example/hooks",
  encryptedSecret: "enc:wh-secret",
  eventTypes: [],
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
};

function setupExportSource() {
  prismaMock.organization.findUnique.mockResolvedValue({
    id: SOURCE_ORG_ID,
    slug: "acme",
    name: "Acme",
    plan: "FREE",
    region: "default",
    dataKeyCiphertext: null,
    dekWrapKeyId: null,
    byokWrapKeyId: null,
    suspendedAt: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  prismaMock.organizationSettings.findUnique.mockResolvedValue(null);
  prismaMock.team.findMany.mockResolvedValue([teamA] as never);
  prismaMock.environment.findMany.mockResolvedValue([envA] as never);
  prismaMock.vectorNode.findMany.mockResolvedValue([]);
  prismaMock.pipeline.findMany.mockResolvedValue([pipelineA] as never);
  prismaMock.pipelineVersion.findMany.mockResolvedValue([
    pipelineVersionA,
  ] as never);
  prismaMock.alertRule.findMany.mockResolvedValue([alertRuleA] as never);
  prismaMock.notificationChannel.findMany.mockResolvedValue([
    notificationChannelA,
  ] as never);
  prismaMock.alertRuleChannel.findMany.mockResolvedValue([
    { id: "arc-A1", alertRuleId: "ar-A1", channelId: "ch-A1" },
  ] as never);
  prismaMock.webhookEndpoint.findMany.mockResolvedValue([
    webhookEndpointA,
  ] as never);
  prismaMock.auditLog.findMany.mockResolvedValue([]);
  prismaMock.orgMember.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.orgAccessGrant.findMany.mockResolvedValue([]);
}

/**
 * In-memory import sink. Captures every .create call so the test can
 * read the inserted rows back out without dragging in a real Postgres.
 */
function makeImportSink() {
  const inserted: {
    teams: Array<Record<string, unknown>>;
    environments: Array<Record<string, unknown>>;
    pipelines: Array<Record<string, unknown>>;
    pipelineVersions: Array<Record<string, unknown>>;
    alertRules: Array<Record<string, unknown>>;
    notificationChannels: Array<Record<string, unknown>>;
    webhookEndpoints: Array<Record<string, unknown>>;
    alertRuleChannels: Array<Record<string, unknown>>;
  } = {
    teams: [],
    environments: [],
    pipelines: [],
    pipelineVersions: [],
    alertRules: [],
    notificationChannels: [],
    webhookEndpoints: [],
    alertRuleChannels: [],
  };

  const sink = (
    bucket: keyof typeof inserted,
  ): { create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>> } => ({
    create: async ({ data }) => {
      inserted[bucket].push(data);
      return data;
    },
  });

  const client: OrgDataImportPrisma = {
    team: sink("teams") as never,
    environment: sink("environments") as never,
    pipeline: sink("pipelines") as never,
    pipelineVersion: sink("pipelineVersions") as never,
    alertRule: sink("alertRules") as never,
    notificationChannel: sink("notificationChannels") as never,
    webhookEndpoint: sink("webhookEndpoints") as never,
    alertRuleChannel: sink("alertRuleChannels") as never,
  };

  return { client, inserted };
}

beforeEach(() => {
  mockReset(prismaMock);
});

describe("importOrgData ", () => {
  it("rejects when no targetOrganizationId is supplied", async () => {
    const sink = makeImportSink();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      importOrgData({ data: {} } as any, "", { client: sink.client }),
    ).rejects.toThrow(/targetOrganizationId/);
  });

  it("rejects when client is not supplied", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      importOrgData({ data: {} } as any, TARGET_ORG_ID),
    ).rejects.toThrow(/Prisma client must be supplied/);
  });

  it("skips orphan pipelines whose environment is not in the export", async () => {
    const sink = makeImportSink();
    const envelope = {
      version: "v1",
      exportId: "x",
      generatedAt: NOW.toISOString(),
      manifest: { truncated: [] },
      data: {
        organization: null,
        organizationSettings: null,
        teams: [],
        environments: [],
        // Pipeline references env-A1 but no environment row → orphan.
        pipelines: [pipelineA],
        pipelineVersions: [],
        alertRules: [],
        alertChannels: [],
        webhookEndpoints: [],
        auditLog: [],
        orgMembers: [],
        tenantUsers: [],
        orgAccessGrants: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await importOrgData(envelope, TARGET_ORG_ID, {
      client: sink.client,
    });

    expect(result.counts.pipelines).toBe(0);
    expect(sink.inserted.pipelines).toEqual([]);
  });
});

describe("export → import round-trip ", () => {
  it("preserves entity counts and FK topology end-to-end", async () => {
    setupExportSource();
    const envelope = await buildOrgDataExport(SOURCE_ORG_ID);
    const sink = makeImportSink();

    const result = await importOrgData(envelope, TARGET_ORG_ID, {
      client: sink.client,
    });

    // ── 1. counts ─────────────────────────────────────────────────────
    expect(result.counts).toEqual({
      teams: 1,
      environments: 1,
      pipelines: 1,
      pipelineVersions: 1,
      alertRules: 1,
      notificationChannels: 1,
      webhookEndpoints: 1,
      alertRuleChannels: 1,
    });

    // ── 2. every inserted row carries the TARGET org id ──────────────
    //       (skip the join-table inserts; AlertRuleChannel has no
    //        organizationId column — it's scoped via AlertRule.) ──────
    for (const [bucketName, bucket] of Object.entries(sink.inserted) as Array<
      [string, Array<Record<string, unknown>>]
    >) {
      if (bucketName === "alertRuleChannels") continue;
      for (const row of bucket) {
        expect(row.organizationId).toBe(TARGET_ORG_ID);
      }
    }

    // ── 3. ID remap is consistent: env points at the remapped team,
    //       pipeline at the remapped env, pipelineVersion at the
    //       remapped pipeline, etc. ───────────────────────────────────
    const newTeamId = result.remap.teams["team-A1"];
    const newEnvId = result.remap.environments["env-A1"];
    const newPipelineId = result.remap.pipelines["pipe-A1"];

    expect(sink.inserted.environments[0]!.teamId).toBe(newTeamId);
    expect(sink.inserted.pipelines[0]!.environmentId).toBe(newEnvId);
    expect(sink.inserted.pipelineVersions[0]!.pipelineId).toBe(newPipelineId);
    expect(sink.inserted.alertRules[0]!.environmentId).toBe(newEnvId);
    expect(sink.inserted.alertRules[0]!.teamId).toBe(newTeamId);
    expect(sink.inserted.alertRules[0]!.pipelineId).toBe(newPipelineId);
    expect(sink.inserted.notificationChannels[0]!.environmentId).toBe(newEnvId);
    expect(sink.inserted.webhookEndpoints[0]!.teamId).toBe(newTeamId);

    // AlertRuleChannel link survives the round-trip with BOTH FKs remapped.
    const newAlertRuleId = result.remap.alertRules["ar-A1"];
    const newChannelId = result.remap.notificationChannels["ch-A1"];
    expect(sink.inserted.alertRuleChannels[0]!.alertRuleId).toBe(newAlertRuleId);
    expect(sink.inserted.alertRuleChannels[0]!.channelId).toBe(newChannelId);

    // ── 3b. NO `__has_*` redaction marker leaks into the persisted row.
    //       The export rewrites sensitive columns to `__has_<key>: bool`;
    //       Prisma rejects unknown args, so any leak would have failed
    //       at create time \u2014 we still assert defensively in case the
    //       export pattern changes. ────────────────────────────────────
    for (const bucket of Object.values(sink.inserted) as Array<
      Array<Record<string, unknown>>
    >) {
      for (const row of bucket) {
        for (const k of Object.keys(row)) {
          expect(k.startsWith("__has_")).toBe(false);
        }
      }
    }

    // ── 3c. NotificationChannel.config is a real object on the persisted
    //       row even though the export redacted it. (Defaults to `{}` so
    //       Prisma accepts; the target admin re-enters credentials.) ───
    expect(typeof sink.inserted.notificationChannels[0]!.config).toBe("object");
    expect(sink.inserted.notificationChannels[0]!.config).not.toBeNull();

    // ── 4. pipeline `globalConfig` / `nodes` / `edges` are byte-
    //       identical between source and re-imported row (these are
    //       the customer-visible portability artefacts). ─────────────
    const importedPipeline = sink.inserted.pipelines[0]!;
    expect(JSON.stringify(importedPipeline.globalConfig)).toBe(
      JSON.stringify(pipelineA.globalConfig),
    );
    expect(JSON.stringify(importedPipeline.nodes)).toBe(
      JSON.stringify(pipelineA.nodes),
    );
    expect(JSON.stringify(importedPipeline.edges)).toBe(
      JSON.stringify(pipelineA.edges),
    );

    // ── 5. pipelineVersion YAML survives byte-identically ────────────
    const importedPV = sink.inserted.pipelineVersions[0]!;
    expect(importedPV.config).toBe(pipelineVersionA.config);

    // ── 6. new IDs are NOT the source IDs. ───────────────────────────
    expect(newTeamId).not.toBe("team-A1");
    expect(newEnvId).not.toBe("env-A1");
    expect(newPipelineId).not.toBe("pipe-A1");
  });
});
