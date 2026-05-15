/**
 * `withOrgTx(orgId, fn)` — canonical pattern for tenant-scoped DB work.
 *
 * `SET LOCAL app.org_id = '<orgId>'` is only honoured inside an explicit
 * Postgres transaction; setting it on a pooled connection without a
 * transaction would leak the value into the next request that checks
 * out the same connection. Wrapping every tenant-scoped piece of work
 * in `prisma.$transaction` makes RLS the hard backstop:
 *
 *   - Even if a router has a missing `organizationId` WHERE clause,
 *     RLS policies return zero rows.
 *   - Even if PgBouncer is in front of Postgres in transaction-pooling
 *     mode, the `SET LOCAL` is scoped to the transaction's checkout.
 *
 * Every `orgProcedure` and every agent route handler MUST route DB work
 * through this helper. Background schedulers iterating orgs MUST open
 * one `withOrgTx` per org rather than running fleet-wide queries.
 *
 * Implementation note: we use `set_config(name, value, true)`. The
 * `true` argument scopes the setting to the current transaction; no
 * literal interpolation is performed on `orgId` (`set_config` parameter
 * binding handles the value), and the orgId is validated against the
 * stable identifier grammar before reaching the DB anyway.
 */

import { prisma as defaultPrisma } from "@/lib/prisma";

const ORG_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

type PrismaTxClient = {
  $executeRaw(
    template: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
};

interface PrismaLike {
  $transaction<T>(fn: (tx: PrismaTxClient) => Promise<T>): Promise<T>;
}

function validateOrgId(orgId: string): void {
  if (typeof orgId !== "string" || orgId.length === 0 || orgId.length > 64) {
    throw new Error("withOrgTx: orgId must be a non-empty string ≤ 64 chars");
  }
  if (!ORG_ID_PATTERN.test(orgId)) {
    throw new Error(
      "withOrgTx: orgId must match /^[A-Za-z0-9_-]+$/ — got invalid characters",
    );
  }
}

/**
 * Run `fn` inside a transaction with `app.org_id` set to `orgId`.
 * Uses the supplied Prisma client — exposed for unit testing.
 */
export async function withOrgTxOn<T>(
  prisma: PrismaLike,
  orgId: string,
  fn: (tx: PrismaTxClient) => Promise<T>,
): Promise<T> {
  validateOrgId(orgId);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, ${true})`;
    return fn(tx);
  });
}

/** Convenience binding to the default app Prisma client. */
export async function withOrgTx<T>(
  orgId: string,
  fn: (tx: PrismaTxClient) => Promise<T>,
): Promise<T> {
  return withOrgTxOn(defaultPrisma as PrismaLike, orgId, fn);
}
