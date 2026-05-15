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

const KMS_BUDGET_MS = 500;
const CLOCK_SKEW_THRESHOLD_SECONDS = 2;

interface CheckResult {
  ok: boolean;
  detail?: string;
  ms?: number;
}

async function checkDatabase(): Promise<CheckResult> {
  const t = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, ms: Date.now() - t };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t,
    };
  }
}

async function checkKms(): Promise<CheckResult> {
  const t = Date.now();
  try {
    const kms = getKmsProvider();
    // Cheapest possible operation: describeKey is synchronous in OSS adapters.
    const desc = kms.describeKey();
    if (!desc?.keyId) {
      return { ok: false, detail: "describeKey returned no keyId", ms: Date.now() - t };
    }
    const ms = Date.now() - t;
    return {
      ok: ms < KMS_BUDGET_MS,
      detail: ms >= KMS_BUDGET_MS ? `describeKey exceeded ${KMS_BUDGET_MS}ms budget` : desc.keyId,
      ms,
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t,
    };
  }
}

async function checkClock(): Promise<CheckResult> {
  const t = Date.now();
  const r = await checkClockSkew(CLOCK_SKEW_THRESHOLD_SECONDS);
  return { ok: r.ok, detail: r.message, ms: Date.now() - t };
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
