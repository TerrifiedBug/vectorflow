import "@/lib/env";
import { infoLog, errorLog } from "@/lib/logger";
import {
  assertStrictMultiTenantBoot,
  warnTrustForwardedHostIfOn,
  assertRlsEnforcementBoot,
} from "@/lib/strict-multi-tenant-bootcheck";
import { runWithOrgContext } from "@/lib/org-context";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";

export async function registerNodeInstrumentation() {
  // refuse to boot if env signals say this is a strict
  // multi-tenant deployment but VF_STRICT_MULTI_TENANT is unset/typoed.
  // Runs BEFORE any other init so a misconfigured stamp never starts
  // serving traffic.
  assertStrictMultiTenantBoot();
  warnTrustForwardedHostIfOn();
  // refuse to boot if VF_ENFORCE_RLS=true but the DB role still bypasses RLS
  // or the app.org_id policy doesn't fire (the GA gate for the RLS rollout).
  // No-op unless VF_ENFORCE_RLS is explicitly set, so OSS / mid-rollout cloud
  // are unaffected.
  await assertRlsEnforcementBoot();

  // Initialize leader election FIRST — determines which services this instance runs.
  let leaderIsLeader: () => boolean;
  let leaderRenewIntervalMs = 5000;
  try {
    const { initLeaderElection, isLeader, leaderElection } = await import(
      "@/server/services/leader-election"
    );
    await initLeaderElection();
    leaderIsLeader = isLeader;
    leaderRenewIntervalMs = leaderElection.renewIntervalMs ?? 5000;
  } catch (error) {
    errorLog("instrumentation", "Leader election init failed — assuming leadership (single-instance fallback)", error);
    leaderIsLeader = () => true;
  }

  infoLog("instrumentation", `Instance is ${leaderIsLeader() ? "leader" : "follower"} — ${leaderIsLeader() ? "starting" : "skipping"} singleton services`);

  // Initialize Redis pub/sub for cross-instance SSE broadcasting.
  // Runs on EVERY instance (not just leader) since any instance may have browser SSE connections.
  try {
    const { initPubSub } = await import("@/server/services/redis-pubsub");
    await initPubSub();
  } catch (error) {
    errorLog("instrumentation", "Redis pub/sub init failed — continuing without cross-instance SSE", error);
  }

  // Hydrate the live metric cache (L1) from Redis (L2) on boot so a restarted /
  // failed-over instance serves current throughput immediately instead of zeros
  // until the next heartbeat. Runs on EVERY instance, best-effort: with no Redis
  // it stays in-memory only (current single-instance behavior).
  try {
    const { metricStore } = await import("@/server/services/metric-store");
    const hydrated = await metricStore.hydrateFromRedis();
    if (hydrated > 0) {
      infoLog(
        "instrumentation",
        `Metric store hydrated ${hydrated} samples from Redis L2`,
      );
    }
  } catch (error) {
    errorLog(
      "instrumentation",
      "Metric store hydrate failed — continuing in-memory only",
      error,
    );
  }

  // Start system Vector process if a deployed system pipeline exists.
  // NOTE: System Vector runs on every instance — it's not a singleton service.
  try {
    await runWithOrgContext(DEFAULT_ORG_ID, async () => {
      const { prisma } = await import("@/lib/prisma");
      const { startSystemVector } = await import(
        "@/server/services/system-vector"
      );

      // Ensure the system environment has a team (backfill for pre-system-team installs)
      const { getOrCreateSystemEnvironment } = await import(
        "@/server/services/system-environment"
      );
      await getOrCreateSystemEnvironment();

      const systemPipeline = await prisma.pipeline.findFirst({
        where: { isSystem: true, isDraft: false, deployedAt: { not: null } },
        select: { id: true },
      });

      if (systemPipeline) {
        const latestVersion = await prisma.pipelineVersion.findFirst({
          where: { pipelineId: systemPipeline.id },
          orderBy: { version: "desc" },
          select: { configYaml: true },
        });

        if (latestVersion?.configYaml) {
          infoLog("instrumentation", "Starting system Vector process for deployed system pipeline");
          await startSystemVector(latestVersion.configYaml);
        }
      }
    });
  } catch (error) {
    // Startup failure should not prevent the server from booting.
    errorLog("instrumentation", "Failed to start system Vector on boot", error);
  }

  // Warm the in-process DEK cache so the first wave of agent reconnects
  // after a deployment restart doesn't stampede the wrapping-key
  // service. Keeps p95/p99 agent-enrollment latency stable across
  // rolling deploys. Per-instance (each Node process has its own cache)
  // and best-effort (KMS hiccups warn but don't block boot).
  try {
    const { warmDekCacheForActiveOrgs } = await import(
      "@/server/services/dek-warmup"
    );
    // Time-bound the warm-up so a hung KMS or slow network during a rolling
    // deploy does not block process readiness indefinitely. The warm-up is
    // best-effort: a timeout here means the first wave of requests warm
    // on-demand at modest latency, which is acceptable.
    const WARMUP_TIMEOUT_MS = 30_000;
    await Promise.race([
      warmDekCacheForActiveOrgs(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DEK warm-up timed out")), WARMUP_TIMEOUT_MS),
      ),
    ]);
  } catch (error) {
    errorLog("instrumentation", "DEK cache warm-up failed (non-fatal)", error);
  }

  async function startSingletonServices(): Promise<void> {
    // Demo-mode only: synthesise missing PipelineVersion rows for seeded
    // pipelines so the editor shows them as properly deployed instead of
    // permanently flagging "Saved draft pending deploy". No-op otherwise.
    // Gated behind leader election because the (findMany none → create v1)
    // pattern would race with no unique on (pipelineId, version).
    try {
      const { bootstrapDemoDeployments } = await import(
        "@/server/services/demo-bootstrap"
      );
      await bootstrapDemoDeployments();
    } catch (error) {
      errorLog("instrumentation", "Demo deployment bootstrap failed", error);
    }

    try {
      // Seed (upsert) the built-in DLP transform templates. Idempotent
      // by design — upsert on a stable id — so it is safe to run on
      // every leader-elected boot. We gate it behind leader election so
      // a wide rolling deploy does not stampede the Template table with
      // identical writes from every replica.
      const { seedDlpTemplates } = await import(
        "@/server/services/dlp-template-seed"
      );
      await runWithOrgContext(DEFAULT_ORG_ID, () => seedDlpTemplates());
      infoLog("instrumentation", "DLP templates seeded");
    } catch (error) {
      errorLog("instrumentation", "Failed to seed DLP templates", error);
    }

    try {
      // VectorFlow Lake: when enabled (VF_LAKE_CLICKHOUSE_URL set), ensure the
      // ClickHouse lake schema exists. Idempotent (CREATE ... IF NOT EXISTS) and
      // a no-op when the lake is disabled, so operators enable the lake by
      // setting the env alone — no manual migration step. Leader-gated to avoid
      // concurrent DDL; best-effort so a transient ClickHouse hiccup never
      // blocks boot (lake reads/writes surface the error when actually used).
      const { runLakeMigrations } = await import(
        "@/server/services/lake/migrate"
      );
      const result = await runLakeMigrations();
      if (!result.skipped) {
        infoLog(
          "instrumentation",
          `Lake schema ready (files=${result.files}, statements=${result.statements})`,
        );
      }
    } catch (error) {
      errorLog(
        "instrumentation",
        "Lake migration failed (non-fatal) — lake reads/writes will error until ClickHouse is reachable",
        error,
      );
    }

    try {
      // VectorFlow Lake: scheduled threshold alerts. Leader-gated and a no-op
      // when the lake is disabled (same contract as runLakeMigrations), so
      // operators get alerting by setting the lake env alone. Best-effort —
      // a scheduler init hiccup never blocks boot.
      const { initLakeAlertScheduler } = await import(
        "@/server/services/lake/lake-alerts"
      );
      initLakeAlertScheduler();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize lake alert scheduler", error);
    }

    try {
      const { importLegacyBackups } = await import("@/server/services/backup");
      const result = await importLegacyBackups();
      infoLog("instrumentation", `Legacy backup import: ${result.imported} imported, ${result.skipped} skipped`);
    } catch (error) {
      errorLog("instrumentation", "Failed to import legacy backups", error);
    }

    try {
      const { initBackupScheduler } = await import(
        "@/server/services/backup-scheduler"
      );
      await initBackupScheduler();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize backup scheduler", error);
    }

    try {
      const { initTelemetryScheduler } = await import(
        "@/server/services/telemetry-scheduler"
      );
      initTelemetryScheduler();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize telemetry scheduler", error);
    }

    try {
      const { initAuthChallengeGc } = await import(
        "@/server/services/auth/auth-challenge-gc"
      );
      initAuthChallengeGc();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize auth-challenge GC", error);
    }

    try {
      const { initRetryService } = await import(
        "@/server/services/retry-service"
      );
      initRetryService();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize retry service", error);
    }

    try {
      const { initAutoRollbackService } = await import(
        "@/server/services/auto-rollback"
      );
      initAutoRollbackService();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize auto-rollback service", error);
    }

    try {
      const { initStagedRolloutService } = await import(
        "@/server/services/staged-rollout"
      );
      initStagedRolloutService();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize staged rollout service", error);
    }

    try {
      const { initFleetAlertService } = await import(
        "@/server/services/fleet-alert-service"
      );
      initFleetAlertService();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize fleet alert service", error);
    }

    try {
      const { initFleetHealthScheduler } = await import(
        "@/server/services/fleet-health-scheduler"
      );
      initFleetHealthScheduler();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize fleet health scheduler", error);
    }

    try {
      const { initGitSyncRetryService } = await import(
        "@/server/services/git-sync-retry"
      );
      initGitSyncRetryService();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize git sync retry service", error);
    }

    try {
      const { initCostOptimizerScheduler } = await import(
        "@/server/services/cost-optimizer-scheduler"
      );
      await initCostOptimizerScheduler();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize cost optimizer scheduler", error);
    }

    try {
      const { initAnomalyDetectionService } = await import(
        "@/server/services/anomaly-detection-job"
      );
      initAnomalyDetectionService();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize anomaly detection service", error);
    }

    try {
      // Dynamic import (matches every sibling here): defer loading the rollup
      // service and its prisma/admin-client deps until the elected leader
      // actually starts singleton services — static import would pull them into
      // the instrumentation hook's eager module graph.
      const { initMetricsRollupScheduler } = await import(
        "@/server/services/metrics-rollup"
      );
      initMetricsRollupScheduler();
    } catch (error) {
      errorLog("instrumentation", "Failed to initialize metrics rollup scheduler", error);
    }
  }

  if (leaderIsLeader()) {
    await startSingletonServices();
  } else {
    const failoverTimer = setInterval(async () => {
      if (leaderIsLeader()) {
        clearInterval(failoverTimer);
        infoLog("instrumentation", "Leadership acquired via failover — starting singleton services");
        await startSingletonServices();
      }
    }, leaderRenewIntervalMs);
  }
}
