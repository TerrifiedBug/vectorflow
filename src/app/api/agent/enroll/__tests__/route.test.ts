import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mock dependencies before importing SUT ─────────────────────────────────

vi.mock("@/server/services/agent-org-binding", () => ({
  resolveAgentOrg: vi.fn().mockResolvedValue({ orgId: "default", orgSlug: "default", isLegacyToken: false }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/agent-token", () => ({
  verifyEnrollmentToken: vi.fn(),
  generateNodeToken: vi.fn(),
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  warnLog: vi.fn(),
}));

// ─── Import SUT + mocks after vi.mock ───────────────────────────────────────

import { POST } from "../route";
import { prisma } from "@/lib/prisma";
import { verifyEnrollmentToken, generateNodeToken } from "@/server/services/agent-token";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/agent/enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockEnv = {
  id: "env-1",
  name: "Production",
  enrollmentTokenHash: "hashed-token",
  team: { id: "team-1" },
};

const mockNode = {
  id: "node-1",
  name: "web-server-01",
  host: "web-server-01",
  environmentId: "env-1",
  status: "HEALTHY",
  nodeTokenHash: "hashed-node-token",
  enrolledAt: new Date(),
  lastHeartbeat: new Date(),
  agentVersion: "1.0.0",
  vectorVersion: "0.40.0",
  os: "linux",
  labels: { region: "us-east" },
  metadata: { enrolledVia: "agent" },
  createdAt: new Date(),
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/agent/enroll -- NODE-03 label template auto-assignment", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.mocked(verifyEnrollmentToken).mockResolvedValue(true);
    vi.mocked(generateNodeToken).mockResolvedValue({
      token: "vf_node_0123456789abcdef_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      hash: "h-abc",
      identifier: "0123456789abcdef",
    });
    prismaMock.environment.findMany.mockResolvedValue([mockEnv] as never);
    // §10 quota gate: $transaction wraps the vectorNode insert. Stub it so
    // the callback runs against the same prismaMock, and arrange the org +
    // count mocks so the FREE plan (5 agents) is below the limit before and
    // after the create. Individual tests can override these.
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
    );
    prismaMock.$executeRaw.mockResolvedValue(0 as never);
    prismaMock.organization.findUnique.mockResolvedValue({ plan: "FREE" } as never);
    prismaMock.vectorNode.count
      .mockResolvedValueOnce(0) // pre-check
      .mockResolvedValueOnce(1); // post-check
    prismaMock.vectorNode.create.mockResolvedValue(mockNode as never);
    prismaMock.nodeStatusEvent.create.mockResolvedValue({} as never);
  });

  it("merges matching NodeGroup label templates into node labels", async () => {
    // Group with criteria matching the node's labels
    prismaMock.nodeGroup.findMany.mockResolvedValue([
      {
        id: "ng-1",
        name: "US East",
        environmentId: "env-1",
        criteria: { region: "us-east" },
        labelTemplate: { env: "prod", tier: "1" },
        requiredLabels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);
    prismaMock.vectorNode.update.mockResolvedValue({
      ...mockNode,
      labels: { region: "us-east", env: "prod", tier: "1" },
    } as never);

    const req = makeRequest({
      token: "vf_enroll_test",
      hostname: "web-server-01",
      agentVersion: "1.0.0",
      vectorVersion: "0.40.0",
      os: "linux",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Should call update with merged labels
    expect(prismaMock.vectorNode.update).toHaveBeenCalledWith({
      where: { id: "node-1" },
      data: {
        labels: {
          region: "us-east",
          env: "prod",
          tier: "1",
        },
      },
    });
  });

  it("skips non-matching NodeGroup label templates", async () => {
    // Node has region: eu-west, but group criteria expects region: us-east
    const nodeWithEuLabels = { ...mockNode, labels: { region: "eu-west" } };
    prismaMock.vectorNode.create.mockResolvedValue(nodeWithEuLabels as never);

    prismaMock.nodeGroup.findMany.mockResolvedValue([
      {
        id: "ng-1",
        name: "US East",
        environmentId: "env-1",
        criteria: { region: "us-east" },
        labelTemplate: { env: "prod" },
        requiredLabels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    const req = makeRequest({
      token: "vf_enroll_test",
      hostname: "eu-server-01",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // No matching criteria -> update should NOT be called
    expect(prismaMock.vectorNode.update).not.toHaveBeenCalled();
  });

  it("does not update labels when no NodeGroups exist", async () => {
    prismaMock.nodeGroup.findMany.mockResolvedValue([]);

    const req = makeRequest({
      token: "vf_enroll_test",
      hostname: "bare-server-01",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Empty nodeGroups -> update should NOT be called
    expect(prismaMock.vectorNode.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent/enroll -- demo mode", () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_VF_DEMO_MODE;

  beforeEach(() => {
    mockReset(prismaMock);
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_VF_DEMO_MODE;
    else process.env.NEXT_PUBLIC_VF_DEMO_MODE = ORIGINAL_ENV;
  });

  it("rejects with 403 when demo mode is active and never touches the database", async () => {
    process.env.NEXT_PUBLIC_VF_DEMO_MODE = "true";

    const req = makeRequest({ token: "vf_enroll_demo", hostname: "demo-host" });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/demo/i);
    expect(prismaMock.environment.findMany).not.toHaveBeenCalled();
    expect(prismaMock.vectorNode.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent/enroll -- per-org agents quota (Phase 5v)", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.mocked(verifyEnrollmentToken).mockResolvedValue(true);
    vi.mocked(generateNodeToken).mockResolvedValue({
      token: "vf_node_0123456789abcdef_bb",
      hash: "h-xyz",
      identifier: "0123456789abcdef",
    });
    prismaMock.environment.findMany.mockResolvedValue([mockEnv] as never);
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
    );
    prismaMock.$executeRaw.mockResolvedValue(0 as never);
  });

  it("returns 402 Payment Required with the upgrade envelope when the plan limit is reached", async () => {
    // FREE plan limit is 5 agents; we're already at 5 -> reject.
    prismaMock.organization.findUnique.mockResolvedValue({ plan: "FREE" } as never);
    prismaMock.vectorNode.count.mockResolvedValueOnce(5);

    const req = makeRequest({
      token: "vf_enroll_test",
      hostname: "over-limit-server",
    });
    const res = await POST(req);

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "Plan limit reached",
      quota: "agents",
      plan: "FREE",
      limit: 5,
      current: 5,
      upgradeUrl: expect.stringContaining("vectorflow.sh"),
    });
    // Quota gate fires before the row is written.
    expect(prismaMock.vectorNode.create).not.toHaveBeenCalled();
  });
});
