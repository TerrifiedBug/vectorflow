import { existsSync } from "fs";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/is-demo-mode";
import { buildHeartbeatPayload, type BuildPayloadInput } from "./telemetry-payload";

const PULSE_URL = "https://pulse.terrifiedbug.com/api/v1/ping";
const FETCH_TIMEOUT_MS = 10_000;

let nextAllowedAtMs: number | null = null;

export function _resetSenderState() {
  nextAllowedAtMs = null;
}

type DeploymentMode = "docker" | "helm" | "bare" | "unknown";

// Detect deployment mode in this priority order:
//   1. explicit override via VF_DEPLOYMENT_MODE
//   2. Kubernetes (KUBERNETES_SERVICE_HOST is injected into every pod) → "helm"
//      (we can't actually distinguish Helm from raw kubectl from the running
//      process, so we report Kubernetes-shaped deployments as "helm")
//   3. Docker (the docker engine creates /.dockerenv inside containers)
//   4. fall back to "bare"; "unknown" is only returned if the override env
//      var is set to a non-enum value
function resolveDeploymentMode(): DeploymentMode {
  const override = process.env.VF_DEPLOYMENT_MODE;
  if (override) {
    if (override === "docker" || override === "helm" || override === "bare") return override;
    return "unknown";
  }
  if (process.env.KUBERNETES_SERVICE_HOST) return "helm";
  try {
    if (existsSync("/.dockerenv")) return "docker";
  } catch {
    // Filesystem probe failed (likely sandboxed) — fall through.
  }
  return "bare";
}

// Pipeline model uses isDraft (boolean) and deployedAt (DateTime?) — no status enum.
//   draft   = isDraft: true
//   active  = isDraft: false, deployedAt: not null
//   paused  = isDraft: false, deployedAt: null
async function gatherCounts(): Promise<Pick<BuildPayloadInput, "agentCount" | "pipelineCount">> {
  const [draft, active, paused, agentCount] = await Promise.all([
    prisma.pipeline.count({ where: { isDraft: true } }),
    prisma.pipeline.count({ where: { isDraft: false, deployedAt: { not: null } } }),
    prisma.pipeline.count({ where: { isDraft: false, deployedAt: null } }),
    // Fleet agents are VectorNode records in VectorFlow.
    prisma.vectorNode.count(),
  ]);

  return {
    agentCount,
    pipelineCount: { active, paused, draft },
  };
}

export async function sendTelemetryHeartbeat(): Promise<void> {
  if (isDemoMode()) return;

  if (nextAllowedAtMs !== null && Date.now() < nextAllowedAtMs) {
    return;
  }

  const settings = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  if (!settings || !settings.telemetryEnabled) return;
  if (!settings.telemetryInstanceId || !settings.telemetryEnabledAt) return;

  const counts = await gatherCounts();

  // OIDC is enabled when oidcIssuer is non-null and non-empty (no oidcEnabled boolean in schema).
  const isOidc = !!settings.oidcIssuer && settings.oidcIssuer.trim().length > 0;

  const payload = buildHeartbeatPayload({
    instanceId: settings.telemetryInstanceId,
    enabledAt: settings.telemetryEnabledAt,
    vfVersion: process.env.VF_VERSION ?? "unknown",
    agentCount: counts.agentCount,
    pipelineCount: counts.pipelineCount,
    authMethod: isOidc ? "oidc" : "credentials",
    deploymentMode: resolveDeploymentMode(),
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(PULSE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    if (res.status === 503) {
      const retryAfter = res.headers.get("retry-after");
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      if (Number.isFinite(seconds) && seconds > 0) {
        nextAllowedAtMs = Date.now() + seconds * 1000;
      }
      return;
    }

    if (!res.ok) {
      const err = new Error(`telemetry POST returned ${res.status}`);
      console.error("[telemetry] heartbeat failed:", err);
      Sentry.captureException(err);
    }
  } catch (err) {
    console.error("[telemetry] heartbeat failed:", err);
    Sentry.captureException(err);
  } finally {
    clearTimeout(timer);
  }
}
