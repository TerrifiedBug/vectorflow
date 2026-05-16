// src/server/services/org-access-grant.ts
//
// Operator break-glass grant lifecycle (request / approve / revoke / expire).
//
// `OrgAccessGrant` (added in Phase 1) is the persistent record of an
// operator requesting time-bound access to a single organization for a
// stated reason. The actual decrypt capability comes from a KMS grant
// token that's only generated in Cloud (vectorflow-cloud private repo); in
// OSS the `kmsGrantToken` column stays null and these helpers track only
// the lifecycle state. The same model and the same `isActive` predicate
// are used in both worlds, so the policy code can live in OSS.
//
// Lifecycle states:
//   PENDING   — row exists, approvedByCustomerAdminId is null.
//   APPROVED  — approvedByCustomerAdminId is set, expiresAt > now,
//               revokedAt is null. This is the only state where
//               `isGrantActive` returns true.
//   EXPIRED   — expiresAt <= now. Treated as inactive even when not
//               explicitly revoked; the periodic expirer normalises by
//               stamping revokedAt.
//   REVOKED   — revokedAt is set (manually by customer admin or by the
//               periodic expirer). Permanent terminal state.
//
// All write helpers run inside a single transaction and re-read the row
// after the update so the caller observes the new state without a
// separate fetch.

import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@/generated/prisma";

export type OrgAccessGrantRow = Prisma.OrgAccessGrantGetPayload<object>;

export interface RequestGrantInput {
  operatorId: string;
  organizationId: string;
  reason: string;
  /** How long, from grant approval, the grant is valid. Defaults to 1 hour. */
  durationMs?: number;
}

export interface ApproveGrantInput {
  grantId: string;
  approvedByCustomerAdminId: string;
}

const DEFAULT_GRANT_TTL_MS = 60 * 60 * 1000;
const MIN_REASON_LENGTH = 16;

/**
 * Type bound used so each helper can run either against the global prisma
 * client or inside a tRPC transaction the caller already opened.
 */
type Client = Pick<PrismaClient, "orgAccessGrant"> & {
  $transaction: PrismaClient["$transaction"];
};

function client(opts?: { tx?: Client }): Client {
  return opts?.tx ?? (prisma as unknown as Client);
}

/**
 * Returns true when a grant row is in the APPROVED state: customer
 * admin approved, not yet expired, not revoked. Pure function — callers
 * pass the row they already hold.
 */
export function isGrantActive(
  grant: Pick<
    OrgAccessGrantRow,
    "approvedByCustomerAdminId" | "expiresAt" | "revokedAt"
  >,
  now: Date = new Date(),
): boolean {
  if (grant.approvedByCustomerAdminId == null) return false;
  if (grant.revokedAt != null) return false;
  return grant.expiresAt.getTime() > now.getTime();
}

/**
 * Operator records a break-glass request. The request is NOT active until
 * a customer admin approves it (`approvedByCustomerAdminId` stays null
 * here). `expiresAt` is provisioned now so the request has a built-in
 * deadline regardless of approval delay.
 */
export async function requestOrgAccessGrant(
  input: RequestGrantInput,
  opts: { tx?: Client; now?: Date } = {},
): Promise<OrgAccessGrantRow> {
  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    throw new Error(
      `org-access-grant: reason must be at least ${MIN_REASON_LENGTH} characters (got ${input.reason.trim().length}). Operators must explain why decrypt access is needed; "debugging" is not enough.`,
    );
  }
  const now = opts.now ?? new Date();
  const ttl = input.durationMs ?? DEFAULT_GRANT_TTL_MS;
  if (ttl <= 0) {
    throw new Error("org-access-grant: durationMs must be positive");
  }
  const expiresAt = new Date(now.getTime() + ttl);

  return client(opts).orgAccessGrant.create({
    data: {
      operatorId: input.operatorId,
      organizationId: input.organizationId,
      reason: input.reason.trim(),
      expiresAt,
      // approvedByCustomerAdminId left null — request is PENDING.
      // kmsGrantToken left null — only Cloud sets this on approval.
    },
  });
}

/**
 * Customer admin approves an existing pending grant. Idempotent: if the
 * grant is already approved (same admin), returns the row unchanged. If
 * already approved by a DIFFERENT admin, throws to prevent silent
 * reassignment of accountability.
 */
export async function approveOrgAccessGrant(
  input: ApproveGrantInput,
  opts: { tx?: Client; now?: Date } = {},
): Promise<OrgAccessGrantRow> {
  const c = client(opts);
  const now = opts.now ?? new Date();

  const existing = await c.orgAccessGrant.findUnique({
    where: { id: input.grantId },
  });
  if (!existing) {
    throw new Error(`org-access-grant: no grant with id ${input.grantId}`);
  }
  if (existing.revokedAt != null) {
    throw new Error(
      "org-access-grant: cannot approve a revoked grant — operator must submit a new request",
    );
  }
  if (existing.expiresAt.getTime() <= now.getTime()) {
    throw new Error(
      "org-access-grant: cannot approve an expired grant — operator must submit a new request",
    );
  }
  if (existing.approvedByCustomerAdminId != null) {
    if (existing.approvedByCustomerAdminId === input.approvedByCustomerAdminId) {
      return existing; // idempotent re-approval
    }
    throw new Error(
      "org-access-grant: grant already approved by a different customer admin",
    );
  }

  return c.orgAccessGrant.update({
    where: { id: input.grantId },
    data: { approvedByCustomerAdminId: input.approvedByCustomerAdminId },
  });
}

/**
 * Customer admin or operator revokes a grant. Idempotent on already-
 * revoked rows. Sets `revokedAt = now`; does not delete the row.
 */
export async function revokeOrgAccessGrant(
  grantId: string,
  opts: { tx?: Client; now?: Date } = {},
): Promise<OrgAccessGrantRow> {
  const c = client(opts);
  const now = opts.now ?? new Date();
  const existing = await c.orgAccessGrant.findUnique({
    where: { id: grantId },
  });
  if (!existing) {
    throw new Error(`org-access-grant: no grant with id ${grantId}`);
  }
  if (existing.revokedAt != null) {
    return existing; // idempotent
  }
  return c.orgAccessGrant.update({
    where: { id: grantId },
    data: { revokedAt: now },
  });
}

/**
 * Periodic janitor: stamps `revokedAt` on every grant whose `expiresAt`
 * has passed and which hasn't already been revoked. Returns the number of
 * rows touched. Intended to run from a scheduler (~every minute) so the
 * REVOKED state is the only terminal state operators have to reason
 * about.
 *
 * Concurrency: uses a single UPDATE with WHERE clause so two concurrent
 * runs don't double-stamp.
 */
export async function expireStaleOrgAccessGrants(
  opts: { tx?: Client; now?: Date } = {},
): Promise<number> {
  const c = client(opts);
  const now = opts.now ?? new Date();
  const result = await c.orgAccessGrant.updateMany({
    where: {
      revokedAt: null,
      expiresAt: { lte: now },
    },
    data: { revokedAt: now },
  });
  return result.count;
}

/**
 * List grants for one org. Used by the customer-side admin UI: pending
 * + approved + expired/revoked, with the kmsGrantToken always projected
 * to a boolean presence flag so the customer admin can see THAT a token
 * was issued without seeing the token itself.
 */
export async function listOrgAccessGrantsForOrg(
  organizationId: string,
  opts: { tx?: Client; limit?: number } = {},
): Promise<
  Array<
    Omit<OrgAccessGrantRow, "kmsGrantToken"> & {
      hasKmsGrantToken: boolean;
    }
  >
> {
  const c = client(opts);
  const rows = await c.orgAccessGrant.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 100,
  });
  return rows.map(({ kmsGrantToken, ...rest }) => ({
    ...rest,
    hasKmsGrantToken: kmsGrantToken != null,
  }));
}
