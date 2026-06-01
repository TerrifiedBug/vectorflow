/**
 * Per-request organization scope for database row-level security.
 *
 * This is the single source of truth for "which organization's data may
 * the current async execution touch". The Prisma RLS extension
 * (`src/lib/prisma.ts`) reads it on every model query and, when set,
 * wraps the query in a transaction that runs
 *
 *     SELECT set_config('app.org_id', <orgId>, true)
 *
 * first, so the strict RLS policies on every tenant table
 * (`"organizationId" = current_setting('app.org_id', true)`) fire for
 * exactly this org. When NO scope is set, the fenced `vectorflow_app`
 * role sees zero rows for tenant tables — the safe default that turns a
 * forgotten entry-point wrap into "this surface shows nothing" rather
 * than a cross-tenant leak.
 *
 * Wiring contract — every request boundary that has resolved which org
 * it serves MUST run its handler inside `runWithOrgContext(orgId, fn)`:
 *
 *   - tRPC: the authenticated procedure middleware (`src/trpc/init.ts`)
 *   - REST v1: `apiRoute` (`src/app/api/v1/_lib/api-handler.ts`)
 *   - Agent API: each `/api/agent/*` route, after `resolveAgentOrg`
 *   - SCIM: each `/api/scim/*` route, after token auth
 *   - Background loops: one `withOrgTx(orgId, …)` per org iteration
 *
 * Why a dedicated store and not `log-context.ts` (which also carries an
 * orgId): log context is best-effort presentation metadata that may be
 * absent or wrong without consequence; org context is a security
 * boundary whose orgId is validated against the stable identifier
 * grammar before it can reach `set_config`. Keeping them separate stops
 * a future "tweak the log tag" change from silently moving the tenancy
 * fence.
 *
 * `AsyncLocalStorage` propagates across every `await` / `.then()` inside
 * the wrapped function, so the scope follows the request through nested
 * service calls without threading `orgId` through every signature.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Stable identifier grammar shared with `withOrgTx` and `set_config`. */
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Validate an orgId before it is used as a tenancy boundary. Throws on
 * anything that does not match the stable identifier grammar (≤ 64 chars,
 * `[A-Za-z0-9_-]`). Defense in depth: the value is parameter-bound into
 * `set_config`, but rejecting malformed ids early keeps a corrupt scope
 * from ever reaching the database.
 */
export function assertValidOrgId(orgId: string, caller = "org-context"): void {
  if (typeof orgId !== "string" || orgId.length === 0 || orgId.length > 64) {
    throw new Error(`${caller}: orgId must be a non-empty string ≤ 64 chars`);
  }
  if (!ORG_ID_PATTERN.test(orgId)) {
    throw new Error(
      `${caller}: orgId must match /^[A-Za-z0-9_-]+$/ — got invalid characters`,
    );
  }
}

interface OrgContext {
  /** Organization whose rows the current execution may read or write. */
  readonly orgId: string;
}

const storage = new AsyncLocalStorage<OrgContext>();

/**
 * Run `fn` with `orgId` as the active database tenancy scope. The orgId
 * is validated first; an invalid id throws rather than silently scoping
 * to nothing.
 */
export async function runWithOrgContext<T>(
  orgId: string,
  fn: () => Promise<T>,
): Promise<T> {
  assertValidOrgId(orgId, "runWithOrgContext");
  // Await `fn` INSIDE `storage.run` so the scope stays active until the work
  // settles. Prisma queries are lazy PrismaPromises: if we merely returned
  // `fn()` (the promise) out of the scope, the RLS extension hook would run
  // at the caller's await — after the scope exited — and read `undefined`,
  // silently dropping the tenant filter to "no context" (zero rows). Awaiting
  // here keeps `getOrgId()` correct for the whole operation.
  return storage.run({ orgId }, async () => fn());
}

/**
 * Read the active org scope, or `undefined` when called outside any
 * `runWithOrgContext` (boot-time work, background ticks, or a code path
 * that has not yet been wired). The Prisma extension treats `undefined`
 * as "no scope" and lets the fenced role's RLS policies deny by default.
 */
export function getOrgId(): string | undefined {
  return storage.getStore()?.orgId;
}

/**
 * Test-only handle on the underlying store. Production code never reaches
 * for this — ALS stores self-clear when the wrapped function returns.
 */
export const _orgContextInternals = { storage };
