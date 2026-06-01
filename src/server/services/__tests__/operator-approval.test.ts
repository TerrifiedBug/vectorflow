/**
/**
 * Unit tests for the OperatorApprovalRequest lifecycle service.
 * Mocks Prisma at the model level.
 *
 * Asserts:
 *   - createApprovalRequest persists PENDING_APPROVAL + expiresAt
 *     respects ttlHours default + override + reason min length;
 *   - approveApprovalRequest enforces the two-person rule
 *     (same-operator approval throws TwoPersonRuleViolation);
 *   - state machine transitions: PENDING_APPROVAL → APPROVED →
 *     EXECUTING → COMPLETED, EXECUTING → FAILED, and the
 *     cancellation paths;
 *   - expireStaleApprovalRequests flips PENDING past expiresAt.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => { const __pm = {}; return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

import {
  ApprovalRequestNotFound,
  ApprovalRequestNotPending,
  DEFAULT_TTL_HOURS,
  TwoPersonRuleViolation,
  approveApprovalRequest,
  cancelApprovalRequest,
  createApprovalRequest,
  expireStaleApprovalRequests,
  markCompleted,
  markExecuting,
  markFailed,
} from "../operator-approval";

interface MockPrisma {
  operatorApprovalRequest: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
}

function makeMockPrisma(): MockPrisma {
  return {
    operatorApprovalRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

const NOW = new Date("2026-05-17T00:00:00.000Z");

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "req_a",
    operation: "backup.restore",
    payload: { recoveryPointArn: "rp_test" },
    organizationId: "org_x",
    requestedByOperatorId: "op_alice",
    approvedByOperatorId: null,
    reason: "incident I-123: customer reports loss after deploy",
    executedByOperatorId: null,
    status: "PENDING_APPROVAL",
    failureReason: null,
    requestedAt: NOW,
    approvedAt: null,
    executedAt: null,
    completedAt: null,
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    ...over,
  };
}

describe("createApprovalRequest", () => {
  it("rejects a too-short reason", async () => {
    const tx = makeMockPrisma();
    await expect(
      createApprovalRequest(
        {
          operation: "backup.restore",
          payload: {},
          requestedByOperatorId: "op_alice",
          reason: "lol",
        },
        { tx: tx as never, now: NOW },
      ),
    ).rejects.toThrow(/at least 12 characters/i);
  });

  it("persists with default TTL = 24h", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.create.mockResolvedValue(row());

    await createApprovalRequest(
      {
        operation: "backup.restore",
        payload: { recoveryPointArn: "rp_test" },
        organizationId: "org_x",
        requestedByOperatorId: "op_alice",
        reason: "incident I-123 customer data loss after deploy",
      },
      { tx: tx as never, now: NOW },
    );

    const call = tx.operatorApprovalRequest.create.mock.calls[0][0].data;
    expect(call.operation).toBe("backup.restore");
    expect(call.requestedByOperatorId).toBe("op_alice");
    expect(call.organizationId).toBe("org_x");
    const expectedExpiry = NOW.getTime() + DEFAULT_TTL_HOURS * 60 * 60 * 1000;
    expect(call.expiresAt.getTime()).toBe(expectedExpiry);
  });

  it("honours a custom ttlHours override", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.create.mockResolvedValue(row());
    await createApprovalRequest(
      {
        operation: "backup.restore",
        payload: {},
        requestedByOperatorId: "op_alice",
        reason: "incident I-123 customer data loss after deploy",
        ttlHours: 1,
      },
      { tx: tx as never, now: NOW },
    );
    const call = tx.operatorApprovalRequest.create.mock.calls[0][0].data;
    expect(call.expiresAt.getTime()).toBe(NOW.getTime() + 60 * 60 * 1000);
  });

  it("rejects non-positive ttlHours", async () => {
    const tx = makeMockPrisma();
    await expect(
      createApprovalRequest(
        {
          operation: "backup.restore",
          payload: {},
          requestedByOperatorId: "op_alice",
          reason: "incident I-123 customer data loss",
          ttlHours: 0,
        },
        { tx: tx as never, now: NOW },
      ),
    ).rejects.toThrow(/ttlHours must be positive/i);
  });
});

describe("approveApprovalRequest — two-person rule", () => {
  it("THROWS when approver is the same operator who requested", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(
      row({ requestedByOperatorId: "op_alice" }),
    );

    await expect(
      approveApprovalRequest(
        { requestId: "req_a", approverOperatorId: "op_alice" },
        { tx: tx as never, now: NOW },
      ),
    ).rejects.toBeInstanceOf(TwoPersonRuleViolation);

    // No update issued — the request stays PENDING.
    expect(tx.operatorApprovalRequest.updateMany).not.toHaveBeenCalled();
  });

  it("succeeds when approver is a different operator", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.findUnique
      .mockResolvedValueOnce(row({ requestedByOperatorId: "op_alice" }))
      .mockResolvedValueOnce(
        row({
          status: "APPROVED",
          approvedByOperatorId: "op_bob",
          approvedAt: NOW,
        }),
      );
    tx.operatorApprovalRequest.updateMany.mockResolvedValue({ count: 1 });

    const result = await approveApprovalRequest(
      { requestId: "req_a", approverOperatorId: "op_bob" },
      { tx: tx as never, now: NOW },
    );

    expect(result.status).toBe("APPROVED");
    expect(result.approvedByOperatorId).toBe("op_bob");
    expect(tx.operatorApprovalRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "req_a",
        status: "PENDING_APPROVAL",
        approvedByOperatorId: null,
        // Race-safe expiry guard: prevents approving after TTL elapses.
        expiresAt: { gt: NOW },
      },
      data: {
        status: "APPROVED",
        approvedByOperatorId: "op_bob",
        approvedAt: NOW,
      },
    });
  });
});

describe("approveApprovalRequest — state guards", () => {
  it("throws when the request is already APPROVED", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(
      row({ status: "APPROVED" }),
    );
    await expect(
      approveApprovalRequest(
        { requestId: "req_a", approverOperatorId: "op_bob" },
        { tx: tx as never, now: NOW },
      ),
    ).rejects.toBeInstanceOf(ApprovalRequestNotPending);
  });

  it("throws when the request doesn't exist", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(null);
    await expect(
      approveApprovalRequest(
        { requestId: "req_missing", approverOperatorId: "op_bob" },
        { tx: tx as never, now: NOW },
      ),
    ).rejects.toBeInstanceOf(ApprovalRequestNotFound);
  });

  it("flips status to EXPIRED when expiresAt has passed at approve-time", async () => {
    const tx = makeMockPrisma();
    const expired = row({
      expiresAt: new Date(NOW.getTime() - 1),
    });
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(expired);
    tx.operatorApprovalRequest.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      approveApprovalRequest(
        { requestId: "req_a", approverOperatorId: "op_bob" },
        { tx: tx as never, now: NOW },
      ),
    ).rejects.toBeInstanceOf(ApprovalRequestNotPending);

    expect(tx.operatorApprovalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req_a", status: "PENDING_APPROVAL" },
      data: { status: "EXPIRED" },
    });
  });
});

describe("markExecuting", () => {
  it("transitions APPROVED → EXECUTING and records the executor", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(
      row({
        status: "EXECUTING",
        executedByOperatorId: "op_carol",
        executedAt: NOW,
      }),
    );

    const result = await markExecuting(
      { requestId: "req_a", executorOperatorId: "op_carol" },
      { tx: tx as never, now: NOW },
    );

    expect(result.status).toBe("EXECUTING");
    expect(result.executedByOperatorId).toBe("op_carol");
    // Must include expiresAt guard to prevent executing stale approvals.
    expect(tx.operatorApprovalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "APPROVED",
          expiresAt: { gt: NOW },
        }),
      }),
    );
  });

  it("throws when the request is not APPROVED", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.updateMany.mockResolvedValue({ count: 0 });
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(
      row({ status: "COMPLETED" }),
    );
    await expect(
      markExecuting(
        { requestId: "req_a", executorOperatorId: "op_carol" },
        { tx: tx as never, now: NOW },
      ),
    ).rejects.toBeInstanceOf(ApprovalRequestNotPending);
  });
});

describe("markCompleted + markFailed", () => {
  it("markCompleted transitions EXECUTING → COMPLETED with completedAt", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(
      row({ status: "COMPLETED", completedAt: NOW }),
    );
    await markCompleted({ requestId: "req_a" }, { tx: tx as never, now: NOW });

    expect(tx.operatorApprovalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req_a", status: "EXECUTING" },
      data: { status: "COMPLETED", completedAt: NOW },
    });
  });

  it("markFailed records failureReason + transitions EXECUTING → FAILED", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(
      row({
        status: "FAILED",
        failureReason: "AWS Backup returned 4xx",
        completedAt: NOW,
      }),
    );
    await markFailed(
      { requestId: "req_a", failureReason: "AWS Backup returned 4xx" },
      { tx: tx as never, now: NOW },
    );

    expect(tx.operatorApprovalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req_a", status: "EXECUTING" },
      data: {
        status: "FAILED",
        failureReason: "AWS Backup returned 4xx",
        completedAt: NOW,
      },
    });
  });
});

describe("cancelApprovalRequest", () => {
  it("cancels a PENDING_APPROVAL row", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(
      row({ status: "CANCELLED" }),
    );

    const result = await cancelApprovalRequest(
      { requestId: "req_a", cancelledByOperatorId: "op_bob" },
      { tx: tx as never },
    );

    expect(result.status).toBe("CANCELLED");
    expect(tx.operatorApprovalRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "req_a",
        status: { in: ["PENDING_APPROVAL", "APPROVED"] },
      },
      data: { status: "CANCELLED" },
    });
  });

  it("cancels an APPROVED row", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(
      row({ status: "CANCELLED" }),
    );
    const result = await cancelApprovalRequest(
      { requestId: "req_a", cancelledByOperatorId: "op_bob" },
      { tx: tx as never },
    );
    expect(result.status).toBe("CANCELLED");
  });

  it("REFUSES to cancel an EXECUTING row (in-flight side-effect)", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.updateMany.mockResolvedValue({ count: 0 });
    tx.operatorApprovalRequest.findUnique.mockResolvedValue(
      row({ status: "EXECUTING" }),
    );
    await expect(
      cancelApprovalRequest(
        { requestId: "req_a", cancelledByOperatorId: "op_bob" },
        { tx: tx as never },
      ),
    ).rejects.toBeInstanceOf(ApprovalRequestNotPending);
  });
});

describe("expireStaleApprovalRequests", () => {
  it("flips PENDING_APPROVAL rows past expiresAt to EXPIRED", async () => {
    const tx = makeMockPrisma();
    tx.operatorApprovalRequest.updateMany.mockResolvedValue({ count: 5 });

    const count = await expireStaleApprovalRequests({
      tx: tx as never,
      now: NOW,
    });

    expect(count).toBe(5);
    expect(tx.operatorApprovalRequest.updateMany).toHaveBeenCalledWith({
      where: {
        status: "PENDING_APPROVAL",
        expiresAt: { lt: NOW },
      },
      data: { status: "EXPIRED" },
    });
  });
});
