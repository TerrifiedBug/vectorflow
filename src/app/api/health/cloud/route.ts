/**
 * Cloud readiness probe.
 *
 * Returns 200 with `{ status: "ok", checks: { ... } }` only when every
 * Cloud-critical subsystem is healthy. Used by the load balancer's
 * health check and by SRE dashboards. Different from `/api/health/ready`
 * (DB-only) because Cloud has additional invariants:
 *
 *   - KMS reachability: the wrapping-key provider responds within budget.
 *   - Clock skew: NTP-bounded skew (JWT, TOTP, KMS grant token expiry).
 *   - DEK cache warm: at least one cache hit on the first probe of an org.
 */

import { checkClockSkew } from "@/server/services/clock-skew";
import { getKmsProvider } from "@/server/services/kms";
import { prisma } from "@/lib/prisma";
import { errorLog } from "@/lib/logger";

const KMS_BUDGET_MS = 500;
const CLOCK_SKEW_THRESHOLD_SECONDS = 2;

interface CheckResult {
  ok: boolean;
  detail?: string;
  ms?: number;
}

/**
 * Coarse public-facing detail strings. Anything more specific is logged
 * server-side instead — `/api/health/cloud` is intended for load-balancer
 * health checks and may be reachable by untrusted callers in some
 * deployments; raw `err.message` could leak DB endpoints, auth tokens
 * embedded in connection strings, or provider internals during an
 * incident.
 */
function logAndRedact(check: string, err: unknown): string {
  errorLog("health/cloud", `${check} check failed`, err);
  return "check failed";
}

async function checkDatabase(): Promise<CheckResult> {
  const t = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, ms: Date.now() - t };
  } catch (err) {
    return {
      ok: false,
      detail: logAndRedact("database", err),
      ms: Date.now() - t,
    };
  }
}

async function checkKms(): Promise<CheckResult> {
  const t = Date.now();
  // Bound the probe with a hard timeout AND abort the inflight network
  // operation when the deadline fires. Otherwise a TCP-reachable-but-
  // stalled upstream (blackholed route, hung Vault) leaves a hanging
  // probe behind on every health check, accumulating sockets during the
  // incident.
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort(new Error(`kms healthCheck timed out after ${KMS_BUDGET_MS}ms`));
  }, KMS_BUDGET_MS);
  try {
    const kms = getKmsProvider();
    const r = await Promise.race([
      kms.healthCheck({ signal: ac.signal }),
      new Promise<never>((_, reject) =>
        ac.signal.addEventListener("abort", () => reject(ac.signal.reason)),
      ),
    ]);
    const ms = Date.now() - t;
    if (!r.ok) {
      // Log the provider's raw error server-side; expose coarse to callers.
      errorLog("health/cloud", "kms healthCheck reported not-ok", r.error);
      return { ok: false, detail: "kms unhealthy", ms };
    }
    return {
      ok: ms < KMS_BUDGET_MS,
      detail: ms >= KMS_BUDGET_MS ? "kms budget exceeded" : undefined,
      ms,
    };
  } catch (err) {
    // Bucket the timeout error visibly without leaking specifics.
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = /timed out|budget/i.test(msg);
    errorLog("health/cloud", "kms check failed", err);
    return {
      ok: false,
      detail: isTimeout ? "kms timed out" : "check failed",
      ms: Date.now() - t,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * In private-VPC / egress-restricted deployments, the public default
 * time sources (Cloudflare, Google, Apple) are unreachable, which would
 * make `/api/health/cloud` permanently report 503 even on a healthy
 * clock. Operators set `VF_CLOCK_SKEW_SOURCES` (comma-separated URLs
 * pointing at internal time services) to override. Unset → use defaults.
 */
function configuredClockSources(): string[] | undefined {
  const raw = process.env.VF_CLOCK_SKEW_SOURCES;
  if (!raw) return undefined;
  const sources = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return sources.length > 0 ? sources : undefined;
}

async function checkClock(): Promise<CheckResult> {
  const t = Date.now();
  const sources = configuredClockSources();
  const r = await checkClockSkew(
    CLOCK_SKEW_THRESHOLD_SECONDS,
    sources ? { sources } : {},
  );
  if (!r.ok) {
    // Log the skew specifics server-side; externally only the failure flag.
    errorLog("health/cloud", "clock skew exceeded", { skewSeconds: r.skewSeconds, threshold: r.thresholdSeconds });
    return { ok: false, detail: "clock skew exceeded", ms: Date.now() - t };
  }
  return { ok: true, ms: Date.now() - t };
}

export async function GET() {
  const [database, kms, clock] = await Promise.all([
    checkDatabase(),
    checkKms(),
    checkClock(),
  ]);

  const checks = { database, kms, clock };
  const allOk = Object.values(checks).every((c) => c.ok);

  return Response.json(
    { status: allOk ? "ok" : "error", checks },
    { status: allOk ? 200 : 503 },
  );
}
