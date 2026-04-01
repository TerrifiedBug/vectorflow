import { NextResponse } from "next/server";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/server/services/agent-auth";
import { collectSecretRefs, convertSecretRefsToEnvVars, resolveCertRefs, secretNameToEnvVar } from "@/server/services/secret-resolver";
import { decrypt } from "@/server/services/crypto";
import { createHash } from "crypto";
import { setExpectedChecksum } from "@/server/services/drift-metrics";
import { checkTokenRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { warnLog, errorLog } from "@/lib/logger";

export async function GET(request: Request) {
  const rateLimited = checkTokenRateLimit(request, "config", 30);
  if (rateLimited) return rateLimited;

  const agent = await authenticateAgent(request);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch the node to check for pending actions (e.g., self-update)
    const node = await prisma.vectorNode.findUnique({
      where: { id: agent.nodeId },
      select: { pendingAction: true, maintenanceMode: true, labels: true },
    });

    if (node?.maintenanceMode) {
      const environment = await prisma.environment.findUnique({
        where: { id: agent.environmentId },
        select: { secretBackend: true },
      });
      const settings = await prisma.systemSettings.findUnique({
        where: { id: "singleton" },
        select: { fleetPollIntervalMs: true },
      });
      return NextResponse.json({
        pipelines: [],
        pollIntervalMs: settings?.fleetPollIntervalMs ?? 15_000,
        secretBackend: environment?.secretBackend ?? "BUILTIN",
        pendingAction: node.pendingAction ?? undefined,
      });
    }

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
    const deployedPipelines = await prisma.pipeline.findMany({
      where: {
        environmentId: agent.environmentId,
        isDraft: false,
        deployedAt: { not: null },
      },
      select: {
        id: true,
        name: true,
        nodeSelector: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, configYaml: true, logLevel: true },
        },
      },
    });

    // Filter pipelines by nodeSelector matching this node's labels.
    // Pipelines without a nodeSelector (or empty selector) deploy to all nodes.
    const nodeLabels = (node?.labels as Record<string, string>) ?? {};
    const pipelines = deployedPipelines.filter((p) => {
      const selector = (p.nodeSelector as Record<string, string>) ?? {};
      return Object.entries(selector).every(
        ([key, value]) => nodeLabels[key] === value,
      );
    });

    const pipelineConfigs = [];
    const certBasePath = "/var/lib/vf-agent/certs";

    // Collect secret names actually referenced across all pipeline configs,
    // then fetch and decrypt only those — not every secret in the environment.
    const secrets: Record<string, string> = {};
    if (environment.secretBackend === "BUILTIN") {
      const referencedNames = new Set<string>();
      for (const p of pipelines) {
        try {
          const ver = p.versions[0];
          if (!ver?.configYaml) continue;
          const parsed = yaml.load(ver.configYaml);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const name of collectSecretRefs(parsed as Record<string, unknown>)) {
              referencedNames.add(name);
            }
          }
        } catch {
          // Skip unparseable configs — they'll be caught again in the per-pipeline loop below
        }
      }

      if (referencedNames.size > 0) {
        const envSecrets = await prisma.secret.findMany({
          where: {
            environmentId: agent.environmentId,
            name: { in: Array.from(referencedNames) },
          },
        });
        for (const s of envSecrets) {
          const envKey = secretNameToEnvVar(s.name);
          if (secrets[envKey] !== undefined) {
            warnLog("agent-config", `Secret name collision: "${s.name}" normalizes to "${envKey}" which is already set`);
          }
          secrets[envKey] = decrypt(s.encryptedValue);
        }
      }
    }

    for (const pipeline of pipelines) {
      try {
        const latestVersion = pipeline.versions[0];
        if (!latestVersion?.configYaml) continue; // no deployed version yet

        const version = latestVersion.version;
        let configYaml = latestVersion.configYaml;
        let certFiles: Array<{ name: string; filename: string; data: string }> = [];

        if (environment.secretBackend === "BUILTIN") {
          // Parse versioned YAML back to objects so we can resolve references
          // at the object level. This ensures js-yaml properly quotes values
          // containing special characters when we re-dump.
          const parsedConfig = yaml.load(configYaml) as Record<string, unknown>;

          // Convert SECRET[name] → ${VF_SECRET_NAME} env var placeholders.
          // Vector interpolates these from environment variables set by the agent.
          const withEnvVars = convertSecretRefsToEnvVars(parsedConfig);

          // Walk config objects and resolve all CERT[name] → deploy file paths
          const { config: withCerts, certFiles: certs } = await resolveCertRefs(
            withEnvVars,
            agent.environmentId,
            certBasePath,
          );
          certFiles = certs;

          // Re-dump to YAML with proper quoting for special characters
          configYaml = yaml.dump(withCerts, { indent: 2, lineWidth: -1, noRefs: true, forceQuotes: true, quotingType: '"' });
        }
        // External backend: configYaml is used as-is with references intact

        // Include secrets in checksum so secret rotation triggers agent restart
        const checksumInput = Object.keys(secrets).length > 0
          ? configYaml + JSON.stringify(secrets, Object.keys(secrets).sort())
          : configYaml;
        const checksum = createHash("sha256").update(checksumInput).digest("hex");
        setExpectedChecksum(pipeline.id, checksum);

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
        errorLog("agent-config", `Failed to generate config for pipeline ${pipeline.id} (${pipeline.name})`, err);
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

    // Build push URL from the incoming request's host
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    const host = request.headers.get("x-forwarded-host")
      ?? request.headers.get("host")
      ?? `localhost:${process.env.PORT ?? 3000}`;
    const pushUrl = `${proto}://${host}/api/agent/push`;

    return NextResponse.json({
      pipelines: pipelineConfigs,
      pollIntervalMs: settings?.fleetPollIntervalMs ?? 15000,
      pushUrl,
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
      ...(node?.pendingAction ? { pendingAction: node.pendingAction } : {}),
    });
  } catch (error) {
    errorLog("agent-config", "Agent config error", error);
    return NextResponse.json(
      { error: "Failed to generate config" },
      { status: 500 },
    );
  }
}
