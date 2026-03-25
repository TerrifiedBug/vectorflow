export async function register() {
  // Only run in the Node.js runtime — Edge doesn't support child_process/fs/path.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Start system Vector process if a deployed system pipeline exists.
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
}
