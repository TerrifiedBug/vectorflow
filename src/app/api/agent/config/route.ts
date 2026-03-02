import { NextResponse } from "next/server";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/server/services/agent-auth";
import { resolveSecretRefs, resolveCertRefs } from "@/server/services/secret-resolver";
import { decrypt } from "@/server/services/crypto";
import { createHash } from "crypto";

export async function GET(request: Request) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const environment = await prisma.environment.findUnique({
      where: { id: agent.environmentId },
      select: {
        id: true,
        secretBackend: true,
        secretBackendConfig: true,
      },
    });

    if (!environment) {
      return NextResponse.json({ error: "Environment not found" }, { status: 404 });
    }

    // Get all deployed (non-draft) pipelines with their latest VERSIONED config.
    // Agents receive the config snapshot from PipelineVersion — NOT live node/edge
    // data — so that saving in the editor doesn't affect agents until an explicit
    // deploy confirms the change.
    const pipelines = await prisma.pipeline.findMany({
      where: {
        environmentId: agent.environmentId,
        isDraft: false,
        deployedAt: { not: null },
      },
      select: {
        id: true,
        name: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, configYaml: true, logLevel: true },
        },
      },
    });

    const pipelineConfigs = [];
    const certBasePath = "/var/lib/vf-agent/certs";

    for (const pipeline of pipelines) {
      try {
        const latestVersion = pipeline.versions[0];
        if (!latestVersion?.configYaml) continue; // no deployed version yet

        const version = latestVersion.version;
        let configYaml = latestVersion.configYaml;
        const secrets: Record<string, string> = {};
        let certFiles: Array<{ name: string; filename: string; data: string }> = [];

        if (environment.secretBackend === "BUILTIN") {
          // Parse versioned YAML back to objects so we can resolve SECRET[]/CERT[]
          // references at the object level. This ensures js-yaml properly quotes
          // values containing special characters when we re-dump.
          const parsedConfig = yaml.load(configYaml) as Record<string, unknown>;

          // Walk config objects and resolve all SECRET[name] → actual values
          const withSecrets = await resolveSecretRefs(parsedConfig, agent.environmentId);

          // Walk config objects and resolve all CERT[name] → deploy file paths
          const { config: withCerts, certFiles: certs } = await resolveCertRefs(
            withSecrets,
            agent.environmentId,
            certBasePath,
          );
          certFiles = certs;

          // Re-dump to YAML with proper quoting for special characters
          configYaml = yaml.dump(withCerts, { indent: 2, lineWidth: -1, noRefs: true });

          // Deliver all environment secrets as env vars
          const envSecrets = await prisma.secret.findMany({
            where: { environmentId: agent.environmentId },
          });
          for (const s of envSecrets) {
            secrets[`VF_SECRET_${s.name}`] = decrypt(s.encryptedValue);
          }
        }
        // External backend: configYaml is used as-is with references intact

        const checksum = createHash("sha256").update(configYaml).digest("hex");

        pipelineConfigs.push({
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          version,
          configYaml,
          checksum,
          ...(latestVersion.logLevel ? { logLevel: latestVersion.logLevel } : {}),
          ...(environment.secretBackend === "BUILTIN" && Object.keys(secrets).length > 0
            ? { secrets }
            : {}),
          ...(certFiles.length > 0 ? { certFiles } : {}),
        });
      } catch (err) {
        console.error(`Failed to generate config for pipeline ${pipeline.id} (${pipeline.name}):`, err);
        continue;
      }
    }

    // Query pending sample requests for deployed pipelines
    const deployedPipelineIds = pipelineConfigs.map((p) => p.pipelineId);
    const pendingSamples = deployedPipelineIds.length > 0
      ? await prisma.eventSampleRequest.findMany({
          where: {
            status: "PENDING",
            pipelineId: { in: deployedPipelineIds },
            expiresAt: { gt: new Date() },
          },
          select: { id: true, pipelineId: true, componentKeys: true, limit: true },
        })
      : [];

    // Get system settings for poll interval
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "singleton" },
      select: { fleetPollIntervalMs: true },
    });

    return NextResponse.json({
      pipelines: pipelineConfigs,
      pollIntervalMs: settings?.fleetPollIntervalMs ?? 15000,
      secretBackend: environment.secretBackend,
      ...(environment.secretBackend !== "BUILTIN"
        ? { secretBackendConfig: environment.secretBackendConfig }
        : {}),
      ...(pendingSamples.length > 0
        ? {
            sampleRequests: pendingSamples.map((s) => ({
              requestId: s.id,
              pipelineId: s.pipelineId,
              componentKeys: s.componentKeys,
              limit: s.limit,
            })),
          }
        : {}),
    });
  } catch (error) {
    console.error("Agent config error:", error);
    return NextResponse.json(
      { error: "Failed to generate config" },
      { status: 500 },
    );
  }
}
