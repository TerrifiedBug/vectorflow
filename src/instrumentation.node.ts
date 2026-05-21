import "@/lib/env";
import { infoLog, errorLog } from "@/lib/logger";
import { assertStrictMultiTenantBoot, warnTrustForwardedHostIfOn, warnMissingMagicLinkTransport } from "@/lib/strict-multi-tenant-bootcheck";

export async function registerNodeInstrumentation() {
  // refuse to boot if env signals say this is a strict
  // multi-tenant deployment but VF_STRICT_MULTI_TENANT is unset/typoed.
  // Runs BEFORE any other init so a misconfigured stamp never starts
  // serving traffic.
  assertStrictMultiTenantBoot();
  warnTrustForwardedHostIfOn();
  warnMissingMagicLinkTransport();

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

  // Start system Vector process if a deployed system pipeline exists.
  // NOTE: System Vector runs on every instance — it's not a singleton service.
  try {
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
