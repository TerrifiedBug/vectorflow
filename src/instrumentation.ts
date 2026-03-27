export async function register() {
  // Only run in the Node.js runtime — Edge doesn't support child_process/fs/path.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

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
    console.error(
      "[instrumentation] Leader election init failed — assuming leadership (single-instance fallback):",
      error,
    );
    leaderIsLeader = () => true;
  }

  console.log(
    `[instrumentation] Instance is ${leaderIsLeader() ? "leader" : "follower"} — ${leaderIsLeader() ? "starting" : "skipping"} singleton services`,
  );

  // Initialize Redis pub/sub for cross-instance SSE broadcasting.
  // Runs on EVERY instance (not just leader) since any instance may have browser SSE connections.
  try {
    const { initPubSub } = await import("@/server/services/redis-pubsub");
    await initPubSub();
  } catch (error) {
    console.error(
      "[instrumentation] Redis pub/sub init failed — continuing without cross-instance SSE:",
      error,
    );
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
        console.log(
          "Starting system Vector process for deployed system pipeline",
        );
        await startSystemVector(latestVersion.configYaml);
      }
    }
  } catch (error) {
    // Startup failure should not prevent the server from booting.
    console.error("Failed to start system Vector on boot:", error);
  }

  // ─── Singleton services (leader-only) ─────────────────────────────────

  async function startSingletonServices(): Promise<void> {
    // Import legacy filesystem backups into BackupRecord table (idempotent).
    try {
      const { importLegacyBackups } = await import("@/server/services/backup");
      const result = await importLegacyBackups();
      console.log(
        `[backup] Legacy import: ${result.imported} imported, ${result.skipped} skipped`,
      );
    } catch (error) {
      console.error("Failed to import legacy backups:", error);
    }

    // Start backup scheduler if enabled.
    try {
      const { initBackupScheduler } = await import(
        "@/server/services/backup-scheduler"
      );
      await initBackupScheduler();
    } catch (error) {
      console.error("Failed to initialize backup scheduler:", error);
    }

    // Start delivery retry service.
    try {
      const { initRetryService } = await import(
        "@/server/services/retry-service"
      );
      initRetryService();
    } catch (error) {
      console.error("Failed to initialize retry service:", error);
    }

    // Start auto-rollback monitoring service.
    try {
      const { initAutoRollbackService } = await import(
        "@/server/services/auto-rollback"
      );
      initAutoRollbackService();
    } catch (error) {
      console.error("Failed to initialize auto-rollback service:", error);
    }

    // Start staged rollout health-check monitoring service.
    try {
      const { initStagedRolloutService } = await import(
        "@/server/services/staged-rollout"
      );
      initStagedRolloutService();
    } catch (error) {
      console.error("Failed to initialize staged rollout service:", error);
    }

    // Start fleet alert evaluation service.
    try {
      const { initFleetAlertService } = await import(
        "@/server/services/fleet-alert-service"
      );
      initFleetAlertService();
    } catch (error) {
      console.error("Failed to initialize fleet alert service:", error);
    }
  }

  if (leaderIsLeader()) {
    await startSingletonServices();
  } else {
    // Follower: poll for leadership acquisition (failover).
    // Once leadership is acquired, start services and stop polling.
    const failoverTimer = setInterval(async () => {
      if (leaderIsLeader()) {
        clearInterval(failoverTimer);
        console.log(
          "[instrumentation] Leadership acquired via failover — starting singleton services",
        );
        await startSingletonServices();
      }
    }, leaderRenewIntervalMs);
  }
}
