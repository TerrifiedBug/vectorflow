import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";
import { getOrgId } from "@/lib/org-context";

const globalForPrisma = globalThis as unknown as {
  basePrisma: PrismaClient | undefined;
  adminPrisma: PrismaClient | undefined;
  _tsdbDetected?: boolean;
};

function createPrismaClient(connectionString: string, max: number): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,

    // Pool size: sized for production fleet scale (100+ pipelines, 5+ nodes).
    // Override via DATABASE_POOL_MAX for workloads with different parallelism needs.
    max,

    // Fail fast on pool exhaustion instead of waiting indefinitely (pg default: 0 = no timeout).
    // 5 s is long enough for a healthy pool to recycle a connection but short enough to
    // surface saturation issues quickly in logs and error responses.
    connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,

    // Keep idle connections warm for 30 s (pg default: 10 s).
    // Matches the typical heartbeat burst interval so connections survive between bursts
    // without accumulating stale handles.
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
  });
  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

/**
 * Row-level-security scoping extension.
 *
 * Every operation — model queries AND top-level raw (`$queryRaw` /
 * `$executeRaw` / `$queryRawUnsafe` / `$executeRawUnsafe`) — is wrapped in a
 * transaction that runs `SELECT set_config('app.org_id', <orgId>, true)`
 * first, where `<orgId>` is the active org context (`src/lib/org-context.ts`).
 * The strict RLS policies on every tenant table then evaluate
 * `"organizationId" = current_setting('app.org_id', true)` against that
 * value, so the fenced `vectorflow_app` role only sees the current org's
 * rows — and a write that names the wrong `organizationId` is rejected by
 * the policy's `WITH CHECK`.
 *
 * Raw operations are covered deliberately: several org-scoped services read
 * fenced tables through raw SQL (e.g. `metrics-query` / `fleet-data` join
 * `Pipeline` / `VectorNode`), so scoping only model ops would leave those
 * returning zero rows under the fenced role even inside `runWithOrgContext`.
 *
 * When there is NO active org context the query runs unwrapped: under the
 * fenced role the policy denies (zero rows / blocked write — the safe default
 * for an un-wired path); under the OSS table-owner role it behaves exactly as
 * before this extension existed. Boot probes and health checks issue
 * `$queryRaw` with no context and so pass through unwrapped.
 *
 * `$allOperations` is registered at the TOP LEVEL (not under `$allModels`) so
 * it also fires for raw operations. This does NOT recurse: the wrapping
 * transaction and the `set_config` are issued on the *base* client (the
 * closure `client`, un-extended), so neither re-enters this hook, and
 * `query(args)` is the engine's next-fn rather than a fresh extended-client
 * call. The array form runs both statements sequentially on one connection
 * checkout; `set_config(_, _, true)` scopes the GUC to that checkout, so it
 * survives PgBouncer transaction pooling and never leaks to the next request.
 */
function applyRlsScoping(client: PrismaClient) {
  return client.$extends({
    name: "rls-org-scoping",
    query: {
      async $allOperations({ args, query }) {
        const orgId = getOrgId();
        if (orgId === undefined) {
          return query(args);
        }
        const [, result] = await client.$transaction([
          client.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`,
          query(args),
        ]);
        return result;
      },
    },
  });
}

/**
 * Base (un-extended) app client. Connects as the runtime role — the fenced
 * NOBYPASSRLS `vectorflow_app` role in multi-tenant cloud, the table owner
 * in OSS.
 *
 * Exposed for `withOrgTx`, which opens its OWN transaction and sets
 * `app.org_id` itself: it MUST bypass the RLS extension, because routing an
 * interactive transaction's inner queries through the extension would open a
 * second, separate transaction on a different connection (breaking
 * atomicity). Direct bare use of `basePrisma` outside `withOrgTx` is unscoped
 * and, under the fenced role, sees zero tenant rows — use `prisma` instead.
 */
export const basePrisma =
  globalForPrisma.basePrisma ??
  createPrismaClient(env.DATABASE_URL, env.DATABASE_POOL_MAX);

/**
 * Default application client. Every bare query is transparently scoped to
 * the active org context via the RLS extension. This is what application
 * code imports.
 */
export const prisma = applyRlsScoping(basePrisma);

/**
 * Admin / owner client for legitimate pre-context and cross-org work:
 * credential→org resolution before any tenancy scope exists, operator /
 * platform-wide reads, migrations, and the cross-org maintenance loops.
 *
 * Uses `DATABASE_ADMIN_URL` (the BYPASSRLS owner role) when set; otherwise
 * falls back to the base client. That fallback is correct for OSS, where the
 * app role IS the table owner and already bypasses RLS — but a multi-tenant
 * deployment that flips `DATABASE_URL` to the fenced role MUST also set
 * `DATABASE_ADMIN_URL`, or these cross-org paths inherit the fence and break
 * (the boot probe warns when `VF_ENFORCE_RLS=true` without an admin URL).
 *
 * NEVER carries the RLS extension — it is the deliberate escape hatch and is
 * only imported from audited cross-org callsites.
 */
export const adminPrisma: PrismaClient = env.DATABASE_ADMIN_URL
  ? globalForPrisma.adminPrisma ??
    createPrismaClient(
      env.DATABASE_ADMIN_URL,
      Math.max(2, Math.min(10, env.DATABASE_POOL_MAX)),
    )
  : basePrisma;

if (env.NODE_ENV !== "production") {
  globalForPrisma.basePrisma = basePrisma;
  if (env.DATABASE_ADMIN_URL) globalForPrisma.adminPrisma = adminPrisma;
}

import { detectTimescaleDb } from "@/server/services/timescaledb";

// Detect TimescaleDB availability on first import.
// Non-blocking — logs result and caches for runtime queries.
if (typeof globalThis !== "undefined" && !globalForPrisma._tsdbDetected) {
  globalForPrisma._tsdbDetected = true;
  detectTimescaleDb().catch(() => {
    // Swallowed — detectTimescaleDb already logs the warning
  });
}
