export async function register() {
  // Start system Vector process if a deployed system pipeline exists.
  // We lazy-import to avoid pulling server-only modules into edge/client builds.
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
}
