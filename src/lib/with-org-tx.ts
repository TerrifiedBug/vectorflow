/**
 * `withOrgTx(orgId, fn)` — canonical pattern for tenant-scoped DB work
 * that spans more than one statement (multi-step transactions).
 *
 * Single bare queries do NOT need this: the Prisma RLS extension
 * (`src/lib/prisma.ts`) already wraps every model query in a
 * `set_config('app.org_id', …)` transaction off the active org context
 * (`src/lib/org-context.ts`). `withOrgTx` exists for the cases the
 * extension cannot cover on its own — an explicit, interactive
 * `$transaction` block where several statements must commit atomically.
 *
 * It runs on the BASE (un-extended) client deliberately: routing the
 * inner statements through the extended client would make each one open
 * its own separate transaction on a different connection, breaking
 * atomicity. Here a single `SET LOCAL app.org_id` (via
 * `set_config(name, value, true)`) covers every statement in the block.
 *
 *   - `set_config(_, _, true)` scopes the GUC to this transaction's
 *     connection checkout, so it survives PgBouncer transaction pooling
 *     and never leaks to the next request.
 *   - The block also runs inside `runWithOrgContext(orgId, …)` so any
 *     incidental logging or service call inside observes the same org.
 *
 * Every background scheduler iterating orgs MUST open one `withOrgTx`
 * per org rather than running a fleet-wide query.
 */

import { Prisma } from "@/generated/prisma";
import { basePrisma } from "@/lib/prisma";
import { assertValidOrgId, getOrgId, runWithOrgContext } from "@/lib/org-context";

type TenantTxFn<T> = (tx: Prisma.TransactionClient) => Promise<T>;

/**
 * Options forwarded to the underlying interactive `$transaction`. The
 * isolation-level union is derived from the generated enum value so it tracks
 * Prisma without depending on a type export that this version does not expose.
 */
type OrgTransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: (typeof Prisma.TransactionIsolationLevel)[keyof typeof Prisma.TransactionIsolationLevel];
};

/** Minimal client surface needed to open an interactive transaction. */
interface TxCapableClient {
  $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: OrgTransactionOptions,
  ): Promise<T>;
}

/**
 * Run `fn` inside a transaction with `app.org_id` set to `orgId`.
 * Uses the supplied client — exposed for unit testing. `options` forwards
 * Prisma transaction options (e.g. `{ isolationLevel: "Serializable" }`).
 */
export async function withOrgTxOn<T>(
  client: TxCapableClient,
  orgId: string,
  fn: TenantTxFn<T>,
  options?: OrgTransactionOptions,
): Promise<T> {
  // Validate BEFORE the transaction: the value is parameter-bound into
  // set_config, but a malformed id must never reach the DB at all.
  assertValidOrgId(orgId, "withOrgTx");
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, ${true})`;
    return runWithOrgContext(orgId, () => fn(tx));
  }, options);
}

/** Convenience binding to the base app Prisma client. */
export async function withOrgTx<T>(
  orgId: string,
  fn: TenantTxFn<T>,
  options?: OrgTransactionOptions,
): Promise<T> {
  return withOrgTxOn(basePrisma, orgId, fn, options);
}

/**
 * Like `withOrgTx`, but derives the org from the active request/loop scope
 * (`getOrgId()`) instead of an explicit argument. For service-layer
 * multi-statement transactions that operate on the current request's org but
 * do not carry an `organizationId` parameter — the entry point (tRPC / REST /
 * agent) or background loop has already established the scope via
 * `runWithOrgContext` / `withOrgTx`.
 *
 * Throws when no scope is active rather than silently running unscoped, so an
 * un-wired caller (e.g. a scheduler that forgot to iterate per org) fails
 * loudly instead of leaking or returning nothing.
 */
export async function withOrgTxFromContext<T>(
  fn: TenantTxFn<T>,
  options?: OrgTransactionOptions,
): Promise<T> {
  const orgId = getOrgId();
  if (orgId === undefined) {
    throw new Error(
      "withOrgTxFromContext: no active org context — call within " +
        "runWithOrgContext(orgId, …) / withOrgTx(orgId, …), or pass an " +
        "explicit org via withOrgTx(orgId, fn).",
    );
  }
  return withOrgTx(orgId, fn, options);
}
