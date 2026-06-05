import { NextResponse } from "next/server";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma";
import { runWithOrgContext } from "@/lib/org-context";
import { authenticateAgentInOrg } from "@/server/services/agent-auth";
import { resolveAgentOrg } from "@/server/services/agent-org-binding";
import { collectSecretRefs, convertSecretRefsToEnvVars, resolveCertRefs, secretNameToEnvVar } from "@/server/services/secret-resolver";
import { collectVarRefs, resolveVarRefs } from "@/server/services/variable-resolver";
import { decrypt, ENCRYPTION_DOMAINS } from "@/server/services/crypto";
import {
  decryptForOrgOrFallback,
  loadOrgDataKeyCiphertext,
} from "@/server/services/crypto-v3-callsite";
import { fetchVaultSecrets, readVaultSecretObject, type VaultBackendConfig } from "@/server/services/vault-client";
import { createHash } from "crypto";
import { setExpectedChecksum } from "@/server/services/drift-metrics";
import { checkTokenRateLimit } from "@/app/api/_lib/ip-rate-limit";
import { warnLog, errorLog } from "@/lib/logger";
import { getOrgSettings } from "@/lib/org-settings";
import { isLakeEnabled, getLakeConfig } from "@/server/services/lake/clickhouse";
import { resolveLakeSinkForDelivery, type LakeSinkCreds } from "@/lib/vector/lake-sink";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function decryptVaultConfig(config: unknown): VaultBackendConfig {
  if (!isRecord(config)) {
    throw new Error("Vault secret backend config is missing");
  }

  const decrypted = { ...config } as Record<string, unknown>;
  for (const key of ["token", "secretId"]) {
    const value = decrypted[key];
    if (typeof value === "string" && value.length > 0) {
      decrypted[key] = decrypt(value);
    }
  }
  return decrypted as unknown as VaultBackendConfig;
}
function resolveVaultSecretsFromObject(
  data: Record<string, unknown>,
  basePath: string,
  secretNames: Iterable<string>,
): Map<string, string> {
  const secrets = new Map<string, string>();
  for (const secretName of secretNames) {
    const value = data[secretName];
    if (typeof value === "string") {
      secrets.set(secretName, value);
      continue;
    }
    if (!(secretName in data)) {
      throw new Error(`Vault field "${secretName}" was not found in "${basePath}"`);
    }
    throw new Error(`Vault field "${secretName}" in "${basePath}" must be a string`);
  }
  return secrets;
}

export async function GET(request: Request) {
  const rateLimited = await checkTokenRateLimit(request, "config", 30);
  if (rateLimited) return rateLimited;

  const orgResult = await resolveAgentOrg(request);
  if (orgResult instanceof Response) return orgResult;

  const agent = await authenticateAgentInOrg(request, orgResult.orgId);
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runWithOrgContext(orgResult.orgId, async () => {
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
      const orgSettings = await getOrgSettings(orgResult.orgId);
      return NextResponse.json({
        pipelines: [],
        pollIntervalMs: orgSettings.fleetPollIntervalMs ?? 15_000,
        secretBackend: environment?.secretBackend ?? "BUILTIN",
        pendingAction: node.pendingAction ?? undefined,
      });
    }

    const environment = await prisma.environment.findUnique({
      where: { id: agent.environmentId },
      select: {
        id: true,
        organizationId: true,
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
        // Paused pipelines are excluded from the agent config response so
        // the agent stops them within one poll cycle. pausedAt != null means
        // paused; null means active.
        pausedAt: null,
      },
      select: {
        id: true,
        name: true,
        nodeSelector: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, configYaml: true, logLevel: true, variablesSnapshot: true },
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


    const envVariables = await (prisma.variable?.findMany({
      where: { environmentId: agent.environmentId },
      select: { name: true, value: true },
    }) ?? Promise.resolve([]));
    const envVarMap = new Map(envVariables.map((variable) => [variable.name, variable.value]));

    const pipelineConfigs = [];
    const certBasePath = "/var/lib/vf-agent/certs";

    // Collect secret names actually referenced across all pipeline configs,
    // then fetch and decrypt only those — not every secret in the environment.
    // The decrypted values are keyed by their original secret name so each
    // pipeline can be handed ONLY the secrets it references (per-pipeline
    // scoping, mirroring the VAULT path below) rather than every BUILTIN secret
    // referenced anywhere on the node.
    const builtinSecretsByName = new Map<string, string>();
    const referencedNames = new Set<string>();
    let sharedVaultData: Record<string, unknown> | null = null;
    let vaultConfig: VaultBackendConfig | null = null;
    if (environment.secretBackend === "BUILTIN" || environment.secretBackend === "VAULT") {
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

      if (environment.secretBackend === "BUILTIN" && referencedNames.size > 0) {
        const envSecrets = await prisma.secret.findMany({
          where: {
            environmentId: agent.environmentId,
            name: { in: Array.from(referencedNames) },
          },
          select: { id: true, name: true, encryptedValue: true },
        });
        const dataKeyCiphertext = await loadOrgDataKeyCiphertext(environment.organizationId);
        for (const s of envSecrets) {
          builtinSecretsByName.set(
            s.name,
            await decryptForOrgOrFallback(s.encryptedValue, {
              orgId: environment.organizationId,
              dataKeyCiphertext,
              domain: ENCRYPTION_DOMAINS.GENERIC,
              rowTable: "Secret",
              rowId: `${agent.environmentId}:${s.name}`,
            }),
          );
        }
      }

      if (environment.secretBackend === "VAULT") {
        vaultConfig = decryptVaultConfig(environment.secretBackendConfig);
        if (vaultConfig.basePath && referencedNames.size > 0) {
          sharedVaultData = await readVaultSecretObject(vaultConfig, vaultConfig.basePath);
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
        // Per-pipeline secret map — only the secrets this pipeline references are
        // added below. Never share decrypted secrets across pipelines on a node.
        const pipelineSecrets: Record<string, string> = {};

        // Parse versioned YAML back to objects so we can resolve references
        // at the object level. This ensures js-yaml properly quotes values
        // containing special characters when we re-dump.
        const parsedConfig = yaml.load(configYaml) as Record<string, unknown>;
        const pipelineVars = isRecord(latestVersion.variablesSnapshot)
          ? Object.fromEntries(
              Object.entries(latestVersion.variablesSnapshot).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : {};
        let configForDelivery = parsedConfig;
        let shouldDumpConfig = false;
        const varRefs = collectVarRefs(parsedConfig);

        if (varRefs.size > 0) {
          // If any VAR[...] reference can't be resolved, skip delivering this
          // pipeline entirely. Shipping the un-resolved config would send a
          // literal `VAR[name]` string to the agent, which Vector treats as the
          // intended value — a broken config that silently runs. Skipping keeps
          // the agent on its last-known-good config until the variable is fixed.
          configForDelivery = resolveVarRefs(parsedConfig, pipelineVars, envVarMap);
          shouldDumpConfig = true;
        }

        if (environment.secretBackend === "BUILTIN" || environment.secretBackend === "VAULT") {
          if (environment.secretBackend === "BUILTIN") {
            // Scope BUILTIN secrets to THIS pipeline's references only. The bulk
            // decrypt above keyed every referenced secret by name; here we pick
            // out just the ones this pipeline uses so a pipeline never receives
            // another pipeline's secrets just because they share a node.
            const pipelineSecretRefs = collectSecretRefs(configForDelivery);
            for (const name of pipelineSecretRefs) {
              const value = builtinSecretsByName.get(name);
              if (value === undefined) continue; // missing secrets surface as un-interpolated ${VF_SECRET_*}, unchanged behaviour
              const envKey = secretNameToEnvVar(name);
              if (pipelineSecrets[envKey] !== undefined) {
                warnLog("agent-config", `Secret name collision: "${name}" normalizes to "${envKey}" which is already set`);
              }
              pipelineSecrets[envKey] = value;
            }
          }

          if (environment.secretBackend === "VAULT") {
            const pipelineSecretRefs = collectSecretRefs(configForDelivery);
            if (pipelineSecretRefs.size > 0) {
              const vaultSecrets = sharedVaultData && vaultConfig?.basePath
                ? resolveVaultSecretsFromObject(sharedVaultData, vaultConfig.basePath, pipelineSecretRefs)
                : await fetchVaultSecrets(
                    vaultConfig ?? decryptVaultConfig(environment.secretBackendConfig),
                    Array.from(pipelineSecretRefs),
                    vaultConfig?.basePath ? { basePath: vaultConfig.basePath } : {},
                  );
              for (const [name, value] of vaultSecrets.entries()) {
                const envKey = secretNameToEnvVar(name);
                if (pipelineSecrets[envKey] !== undefined) {
                  warnLog("agent-config", `Secret name collision: "${name}" normalizes to "${envKey}" which is already set`);
                }
                pipelineSecrets[envKey] = value;
              }
            }
          }

          // Convert SECRET[name] → ${VF_SECRET_NAME} env var placeholders.
          // Vector interpolates these from environment variables set by the agent.
          const withEnvVars = convertSecretRefsToEnvVars(configForDelivery);

          // Walk config objects and resolve all CERT[name] → deploy file paths
          const { config: withCerts, certFiles: certs } = await resolveCertRefs(
            withEnvVars,
            agent.environmentId,
            certBasePath,
          );
          certFiles = certs;
          configForDelivery = withCerts;
          shouldDumpConfig = true;
        }

        // Inject the managed VectorFlow Lake sink, if this pipeline routes to it.
        // Endpoint/database/credentials come from the server's lake config (NOT
        // the pipeline graph) and are resolved here at delivery, mirroring the
        // SECRET[...] path above. When the lake is disabled the sink is rewritten
        // to a no-op so the delivered config stays valid and fully inert.
        let lakeCreds: LakeSinkCreds | null = null;
        if (isLakeEnabled()) {
          const lakeCfg = getLakeConfig();
          lakeCreds = {
            endpoint: lakeCfg.url,
            database: lakeCfg.database,
            username: lakeCfg.username,
            password: lakeCfg.password,
          };
        }
        const lakeResult = resolveLakeSinkForDelivery(configForDelivery, lakeCreds, {
          orgId: orgResult.orgId,
          pipelineId: pipeline.id,
        });
        if (lakeResult.applied) {
          configForDelivery = lakeResult.config;
          shouldDumpConfig = true;
        }

        if (shouldDumpConfig) {
          // Re-dump to YAML with proper quoting for special characters
          configYaml = yaml.dump(configForDelivery, { indent: 2, lineWidth: -1, noRefs: true, forceQuotes: true, quotingType: '"' });
        }

        // Include secrets in checksum so secret rotation triggers agent restart
        const checksumInput = Object.keys(pipelineSecrets).length > 0
          ? configYaml + JSON.stringify(pipelineSecrets, Object.keys(pipelineSecrets).sort())
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
          ...((environment.secretBackend === "BUILTIN" || environment.secretBackend === "VAULT") && Object.keys(pipelineSecrets).length > 0
            ? { secrets: pipelineSecrets }
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

    // Get org settings for poll interval
    const orgSettings = await getOrgSettings(orgResult.orgId);

    // Build push URL from the incoming request's host
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    const host = request.headers.get("x-forwarded-host")
      ?? request.headers.get("host")
      ?? `localhost:${process.env.PORT ?? 3000}`;
    const pushUrl = `${proto}://${host}/api/agent/push`;

    return NextResponse.json({
      pipelines: pipelineConfigs,
      pollIntervalMs: orgSettings.fleetPollIntervalMs ?? 15000,
      pushUrl,
      secretBackend: environment.secretBackend,
      ...(environment.secretBackend !== "BUILTIN" && environment.secretBackend !== "VAULT"
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
  });
}
