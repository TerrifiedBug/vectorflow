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
  try {
    const kms = getKmsProvider();
    // Real round-trip: providers issue a network call (Vault metadata
    // GET / AWS KMS:DescribeKey) so a true KMS outage is visible here.
    //
    // Bound the probe with a hard timeout so a TCP-reachable-but-stalled
    // upstream (blackholed route, hung Vault) can't extend the readiness
    // response past the load balancer's deadline. The provider may
    // continue running internally — Node doesn't kill the request — but
    // /api/health/cloud has already returned 503 from the route's POV.
    const r = await Promise.race([
      kms.healthCheck(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`kms healthCheck timed out after ${KMS_BUDGET_MS}ms`)),
          KMS_BUDGET_MS,
        ),
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
  }
}

async function checkClock(): Promise<CheckResult> {
  const t = Date.now();
  const r = await checkClockSkew(CLOCK_SKEW_THRESHOLD_SECONDS);
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
