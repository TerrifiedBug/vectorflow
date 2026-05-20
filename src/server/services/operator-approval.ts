/**
 * `OperatorApprovalRequest` lifecycle service (plan).
 *
 * Generic 2-person approval primitive for privileged operator actions
 * (backup restore, force hard-delete, KMS rotation). The service owns
 * the state machine; handlers own the side-effect (the
 * actual restore, the actual KMS call).
 *
 * State machine:
 *   PENDING_APPROVAL → APPROVED → EXECUTING → COMPLETED | FAILED
 *                ↘ CANCELLED   ↘ CANCELLED
 *                ↘ EXPIRED
 *
 * Two-person rule: `approve(operatorId, requestId)` THROWS when
 * `operatorId === request.requestedByOperatorId`. This is the load-
 * bearing invariant of the dual-control gate — the schema CANNOT
 * enforce it (a `CHECK` constraint would; but the names are
 * deliberately on PlatformOperator rows that may change identifiers
 * via merge-rename flows).
 *
 * Expiration: requests live for `DEFAULT_TTL_HOURS` (24h) unless the
 * caller overrides. The cron sweep `expireStaleApprovalRequests`
 * flips status=EXPIRED for requests past `expiresAt`. Approve / execute
 * also reject EXPIRED rows.
 */

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { prisma as defaultPrisma } from "@/lib/prisma";

export const DEFAULT_TTL_HOURS = 24;

export type ApprovalStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export interface OperatorApprovalRow {
  id: string;
  operation: string;
  payload: Prisma.JsonValue;
  organizationId: string | null;
  requestedByOperatorId: string;
  approvedByOperatorId: string | null;
  reason: string;
  executedByOperatorId: string | null;
  status: ApprovalStatus;
  failureReason: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  executedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date;
}

export interface CreateApprovalRequestInput {
  operation: string;
  payload: Prisma.InputJsonValue;
  organizationId?: string | null;
  requestedByOperatorId: string;
  reason: string;
  ttlHours?: number;
}

type Client = PrismaClient | Prisma.TransactionClient;

function client(opts: { tx?: Client } = {}): Client {
  return opts.tx ?? (defaultPrisma as unknown as PrismaClient);
}

const MIN_REASON_LENGTH = 12;

/**
 * Create a new approval request. Status = PENDING_APPROVAL until a
 * different operator approves.
 */
export async function createApprovalRequest(
  input: CreateApprovalRequestInput,
  opts: { tx?: Client; now?: Date } = {},
): Promise<OperatorApprovalRow> {
  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    throw new Error(
      `operator-approval: reason must be at least ${MIN_REASON_LENGTH} characters (got ${input.reason.trim().length}). Operators must justify dual-control requests.`,
    );
  }
  const now = opts.now ?? new Date();
  const ttl = (input.ttlHours ?? DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
  if (ttl <= 0) {
    throw new Error("operator-approval: ttlHours must be positive");
  }
  const expiresAt = new Date(now.getTime() + ttl);

  return client(opts).operatorApprovalRequest.create({
    data: {
      operation: input.operation,
      payload: input.payload,
      organizationId: input.organizationId ?? null,
      requestedByOperatorId: input.requestedByOperatorId,
      reason: input.reason.trim(),
      expiresAt,
    },
  }) as unknown as Promise<OperatorApprovalRow>;
}

export interface ApproveInput {
  requestId: string;
  approverOperatorId: string;
}

export class TwoPersonRuleViolation extends Error {
  constructor(requestId: string, operatorId: string) {
    super(
      `operator-approval: operator ${operatorId} cannot approve request ${requestId} they themselves submitted (two-person rule)`,
    );
    this.name = "TwoPersonRuleViolation";
  }
}

export class ApprovalRequestNotFound extends Error {
  constructor(requestId: string) {
    super(`operator-approval: request ${requestId} not found`);
    this.name = "ApprovalRequestNotFound";
  }
}

export class ApprovalRequestNotPending extends Error {
  constructor(requestId: string, status: ApprovalStatus) {
    super(
      `operator-approval: request ${requestId} is ${status}, expected PENDING_APPROVAL`,
    );
    this.name = "ApprovalRequestNotPending";
  }
}

/**
 * Approve a pending request. Throws `TwoPersonRuleViolation` when
 * the approver is the same operator who requested. Throws
 * `ApprovalRequestNotPending` when the row is in any other state.
 */
export async function approveApprovalRequest(
  input: ApproveInput,
  opts: { tx?: Client; now?: Date } = {},
): Promise<OperatorApprovalRow> {
  const now = opts.now ?? new Date();
  const c = client(opts);

  const existing = await c.operatorApprovalRequest.findUnique({
    where: { id: input.requestId },
  });
  if (!existing) throw new ApprovalRequestNotFound(input.requestId);
  if (existing.status !== "PENDING_APPROVAL") {
    throw new ApprovalRequestNotPending(
      input.requestId,
      existing.status as ApprovalStatus,
    );
  }
  if (existing.requestedByOperatorId === input.approverOperatorId) {
    throw new TwoPersonRuleViolation(
      input.requestId,
      input.approverOperatorId,
    );
  }
  if (existing.expiresAt.getTime() <= now.getTime()) {
    // Mark expired in the same flow so the caller sees a deterministic
    // failure rather than a "phantom approval" race.
    await c.operatorApprovalRequest.updateMany({
      where: { id: input.requestId, status: "PENDING_APPROVAL" },
      data: { status: "EXPIRED" },
    });
    throw new ApprovalRequestNotPending(input.requestId, "EXPIRED");
  }

  // Race-safe transition: updateMany with the precondition baked in.
  const updated = await c.operatorApprovalRequest.updateMany({
    where: {
      id: input.requestId,
      status: "PENDING_APPROVAL",
      approvedByOperatorId: null,
      // Race-safe expiry guard: if the request expired between the
      // pre-read and this write, the updateMany misses and we surface
      // the correct "not pending" error rather than persisting a
      // post-deadline APPROVED state.
      expiresAt: { gt: now },
    },
    data: {
      status: "APPROVED",
      approvedByOperatorId: input.approverOperatorId,
      approvedAt: now,
    },
  });
  if (updated.count === 0) {
    // Lost the race — re-read to surface the actual current state.
    const reread = await c.operatorApprovalRequest.findUnique({
      where: { id: input.requestId },
    });
    if (!reread) throw new ApprovalRequestNotFound(input.requestId);
    throw new ApprovalRequestNotPending(
      input.requestId,
      reread.status as ApprovalStatus,
    );
  }
  // Re-read for the response (updateMany doesn't return the row).
  const after = await c.operatorApprovalRequest.findUnique({
    where: { id: input.requestId },
  });
  if (!after) throw new ApprovalRequestNotFound(input.requestId);
  return after as unknown as OperatorApprovalRow;
}

export interface MarkExecutingInput {
  requestId: string;
  executorOperatorId: string;
}

/**
 * Mark an APPROVED request as EXECUTING. The handler calls
 * this immediately before invoking the side-effect (e.g. AWS Backup
 * StartRestoreJob). If the handler crashes between mark-executing and
 * complete, the request is stuck at EXECUTING — the operator surface
 * surfaces these for manual reconciliation.
 *
 * Enforces the approval TTL: an APPROVED request that has passed
 * `expiresAt` cannot be executed. `expireStaleApprovalRequests` only
 * sweeps PENDING_APPROVAL rows; an APPROVED row that isn't periodically
 * swept remains at APPROVED status until execution is attempted. Adding
 * `expiresAt: { gt: now }` here closes that window so stale approvals
 * cannot trigger side-effects after the dual-control window elapses.
 */
export async function markExecuting(
  input: MarkExecutingInput,
  opts: { tx?: Client; now?: Date } = {},
): Promise<OperatorApprovalRow> {
  const now = opts.now ?? new Date();
  const c = client(opts);
  const updated = await c.operatorApprovalRequest.updateMany({
    where: {
      id: input.requestId,
      status: "APPROVED",
      // Enforce expiry: do not allow execution of an approval that has
      // passed its TTL even if the periodic sweeper hasn't caught up.
      expiresAt: { gt: now },
    },
    data: {
      status: "EXECUTING",
      executedByOperatorId: input.executorOperatorId,
      executedAt: now,
    },
  });
  if (updated.count === 0) {
    const reread = await c.operatorApprovalRequest.findUnique({
      where: { id: input.requestId },
    });
    if (!reread) throw new ApprovalRequestNotFound(input.requestId);
    throw new ApprovalRequestNotPending(
      input.requestId,
      reread.status as ApprovalStatus,
    );
  }
  const after = await c.operatorApprovalRequest.findUnique({
    where: { id: input.requestId },
  });
  if (!after) throw new ApprovalRequestNotFound(input.requestId);
  return after as unknown as OperatorApprovalRow;
}

export interface MarkCompleteInput {
  requestId: string;
}

export async function markCompleted(
  input: MarkCompleteInput,
  opts: { tx?: Client; now?: Date } = {},
): Promise<OperatorApprovalRow> {
  const now = opts.now ?? new Date();
  const c = client(opts);
  const updated = await c.operatorApprovalRequest.updateMany({
    where: { id: input.requestId, status: "EXECUTING" },
    data: { status: "COMPLETED", completedAt: now },
  });
  if (updated.count === 0) {
    const reread = await c.operatorApprovalRequest.findUnique({
      where: { id: input.requestId },
    });
    if (!reread) throw new ApprovalRequestNotFound(input.requestId);
    throw new ApprovalRequestNotPending(
      input.requestId,
      reread.status as ApprovalStatus,
    );
  }
  const after = await c.operatorApprovalRequest.findUnique({
    where: { id: input.requestId },
  });
  if (!after) throw new ApprovalRequestNotFound(input.requestId);
  return after as unknown as OperatorApprovalRow;
}

export interface MarkFailedInput {
  requestId: string;
  failureReason: string;
}

export async function markFailed(
  input: MarkFailedInput,
  opts: { tx?: Client; now?: Date } = {},
): Promise<OperatorApprovalRow> {
  const now = opts.now ?? new Date();
  const c = client(opts);
  const updated = await c.operatorApprovalRequest.updateMany({
    where: { id: input.requestId, status: "EXECUTING" },
    data: {
      status: "FAILED",
      failureReason: input.failureReason,
      completedAt: now,
    },
  });
  if (updated.count === 0) {
    const reread = await c.operatorApprovalRequest.findUnique({
      where: { id: input.requestId },
    });
    if (!reread) throw new ApprovalRequestNotFound(input.requestId);
    throw new ApprovalRequestNotPending(
      input.requestId,
      reread.status as ApprovalStatus,
    );
  }
  const after = await c.operatorApprovalRequest.findUnique({
    where: { id: input.requestId },
  });
  if (!after) throw new ApprovalRequestNotFound(input.requestId);
  return after as unknown as OperatorApprovalRow;
}

export interface CancelInput {
  requestId: string;
  cancelledByOperatorId: string;
}

/**
 * Cancel a PENDING or APPROVED request before it's executed. Once
 * status=EXECUTING, cancellation requires manual reconciliation by an
 * INFRA operator — the side-effect may already be in flight.
 */
export async function cancelApprovalRequest(
  input: CancelInput,
  opts: { tx?: Client } = {},
): Promise<OperatorApprovalRow> {
  const c = client(opts);
  const updated = await c.operatorApprovalRequest.updateMany({
    where: {
      id: input.requestId,
      status: { in: ["PENDING_APPROVAL", "APPROVED"] },
    },
    data: { status: "CANCELLED" },
  });
  if (updated.count === 0) {
    const reread = await c.operatorApprovalRequest.findUnique({
      where: { id: input.requestId },
    });
    if (!reread) throw new ApprovalRequestNotFound(input.requestId);
    throw new ApprovalRequestNotPending(
      input.requestId,
      reread.status as ApprovalStatus,
    );
  }
  const after = await c.operatorApprovalRequest.findUnique({
    where: { id: input.requestId },
  });
  if (!after) throw new ApprovalRequestNotFound(input.requestId);
  return after as unknown as OperatorApprovalRow;
}

/**
 * Cron sweep — flip PENDING_APPROVAL rows past their expiresAt to
 * EXPIRED so the operator UI doesn't surface stale requests.
 * Returns the count of rows updated.
 */
export async function expireStaleApprovalRequests(
  opts: { tx?: Client; now?: Date } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const c = client(opts);
  const result = await c.operatorApprovalRequest.updateMany({
    where: {
      status: "PENDING_APPROVAL",
      expiresAt: { lt: now },
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}
