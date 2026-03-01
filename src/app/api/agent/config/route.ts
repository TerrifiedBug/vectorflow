import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/server/services/agent-auth";
import { generateVectorYaml } from "@/lib/config-generator";
import { decryptNodeConfig } from "@/server/services/config-crypto";
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

    // Get all deployed (non-draft) pipelines in this environment
    const pipelines = await prisma.pipeline.findMany({
      where: {
        environmentId: agent.environmentId,
        isDraft: false,
        deployedAt: { not: null },
      },
      include: {
        nodes: true,
        edges: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true },
        },
      },
    });

    const pipelineConfigs = [];
    const certBasePath = "/var/lib/vf-agent/certs";

    for (const pipeline of pipelines) {
      try {
        const version = pipeline.versions[0]?.version ?? 1;

        // Build flow edges (shared across backends)
        const flowEdges = pipeline.edges.map((e) => ({
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
        }));

        let configYaml: string;
        const secrets: Record<string, string> = {};
        let certFiles: Array<{ name: string; filename: string; data: string }> = [];

        if (environment.secretBackend === "BUILTIN") {
          // Resolve SECRET[] and CERT[] references to actual values/paths
          const allCertFiles: Array<{ name: string; filename: string; data: string }> = [];
          const resolvedNodes = await Promise.all(
            pipeline.nodes.map(async (n) => {
              const decrypted = decryptNodeConfig(
                n.componentType,
                (n.config as Record<string, unknown>) ?? {},
              );
              const withSecrets = await resolveSecretRefs(decrypted, agent.environmentId);
              const { config: withCerts, certFiles: certs } = await resolveCertRefs(
                withSecrets,
                agent.environmentId,
                certBasePath,
              );
              allCertFiles.push(...certs);
              return {
                id: n.id,
                type: n.kind.toLowerCase(),
                position: { x: n.positionX, y: n.positionY },
                data: {
                  componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
                  componentKey: n.componentKey,
                  config: withCerts,
                  disabled: n.disabled,
                },
              };
            }),
          );

          configYaml = generateVectorYaml(
            resolvedNodes as Parameters<typeof generateVectorYaml>[0],
            flowEdges as Parameters<typeof generateVectorYaml>[1],
            pipeline.globalConfig as Record<string, unknown> | null,
          );
          certFiles = allCertFiles;

          // Deliver all environment secrets as env vars
          const envSecrets = await prisma.secret.findMany({
            where: { environmentId: agent.environmentId },
          });
          for (const s of envSecrets) {
            secrets[`VF_SECRET_${s.name}`] = decrypt(s.encryptedValue);
          }
        } else {
          // External backend — don't resolve secrets, leave references in YAML
          const flowNodes = pipeline.nodes.map((n) => ({
            id: n.id,
            type: n.kind.toLowerCase(),
            position: { x: n.positionX, y: n.positionY },
            data: {
              componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
              componentKey: n.componentKey,
              config: decryptNodeConfig(
                n.componentType,
                (n.config as Record<string, unknown>) ?? {},
              ),
              disabled: n.disabled,
            },
          }));

          configYaml = generateVectorYaml(
            flowNodes as Parameters<typeof generateVectorYaml>[0],
            flowEdges as Parameters<typeof generateVectorYaml>[1],
            pipeline.globalConfig as Record<string, unknown> | null,
          );
        }

        const checksum = createHash("sha256").update(configYaml).digest("hex");

        // Extract log_level from globalConfig — it's a VectorFlow UI key
        // passed to the agent as VECTOR_LOG env var, not in the YAML.
        const logLevel = (pipeline.globalConfig as Record<string, unknown> | null)?.log_level as string | undefined;

        pipelineConfigs.push({
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          version,
          configYaml,
          checksum,
          ...(logLevel ? { logLevel } : {}),
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
    });
  } catch (error) {
    console.error("Agent config error:", error);
    return NextResponse.json(
      { error: "Failed to generate config" },
      { status: 500 },
    );
  }
}
