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
  // No-id tokens (e.g. "vf_enroll_test") return null and take the fan-out path.
  getEnrollmentTokenIdentifier: vi.fn(() => null),
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
import {
  verifyEnrollmentToken,
  generateNodeToken,
  getEnrollmentTokenIdentifier,
} from "@/server/services/agent-token";

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
    // quota gate: $transaction wraps the vectorNode insert. Stub it so
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

describe("POST /api/agent/enroll -- VF-36 token-id fast path", () => {
  // A current enrollment token embeds a 16-hex identifier:
  // vf_enroll_<slug>_<16hex>_<64hex>
  const TOKEN_WITH_ID =
    "vf_enroll_default_0123456789abcdef_fedcba98765432100123456789abcdeffedcba98765432100123456789abcdef";

  beforeEach(() => {
    mockReset(prismaMock);
    // Current-format tokens embed a 16-hex identifier; return it so the route
    // takes the indexed (by-id) fast path. The legacy test below overrides this.
    vi.mocked(getEnrollmentTokenIdentifier).mockReturnValue("0123456789abcdef");
    vi.mocked(verifyEnrollmentToken).mockResolvedValue(true);
    vi.mocked(generateNodeToken).mockResolvedValue({
      token: "vf_node_default_0123456789abcdef_cc",
      hash: "h-id",
      identifier: "0123456789abcdef",
    });
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
    );
    prismaMock.$executeRaw.mockResolvedValue(0 as never);
    prismaMock.organization.findUnique.mockResolvedValue({ plan: "FREE" } as never);
    prismaMock.vectorNode.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prismaMock.vectorNode.create.mockResolvedValue(mockNode as never);
    prismaMock.nodeStatusEvent.create.mockResolvedValue({} as never);
    prismaMock.nodeGroup.findMany.mockResolvedValue([]);
  });

  it("looks up a single environment by enrollmentTokenId instead of scanning all", async () => {
    prismaMock.environment.findFirst.mockResolvedValue(mockEnv as never);

    const req = makeRequest({ token: TOKEN_WITH_ID, hostname: "fast-path-host" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // Fast path: single indexed lookup, no fan-out scan.
    expect(prismaMock.environment.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.environment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ enrollmentTokenId: "0123456789abcdef" }),
      }),
    );
    expect(prismaMock.environment.findMany).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the token id matches no environment (no fan-out)", async () => {
    prismaMock.environment.findFirst.mockResolvedValue(null);

    const req = makeRequest({ token: TOKEN_WITH_ID, hostname: "no-match-host" });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(prismaMock.environment.findFirst).toHaveBeenCalled();
    expect(prismaMock.environment.findMany).not.toHaveBeenCalled();
    expect(prismaMock.vectorNode.create).not.toHaveBeenCalled();
  });

  it("falls back to scanning environments for a legacy (no-id) token", async () => {
    vi.mocked(getEnrollmentTokenIdentifier).mockReturnValue(null);
    prismaMock.environment.findMany.mockResolvedValue([mockEnv] as never);

    const req = makeRequest({ token: "vf_enroll_legacytoken", hostname: "legacy-host" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // Legacy path: scan, never the indexed single lookup.
    expect(prismaMock.environment.findMany).toHaveBeenCalled();
    expect(prismaMock.environment.findFirst).not.toHaveBeenCalled();
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

describe("POST /api/agent/enroll — per-org agents quota", () => {
  beforeEach(async () => {
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

    // Install a finite-limit quota provider for this suite so
    // the OSS default (unbounded) doesn't trivially pass the gate.
    const { setQuotaPolicy } = await import("@/server/services/quotas");
    setQuotaPolicy({
      getPlanQuotas: () => ({ agents: 5, pipelines: 10, environments: 1 }),
    });
  });

  afterEach(async () => {
    const { resetQuotaPolicy } = await import("@/server/services/quotas");
    resetQuotaPolicy();
  });

  it("returns 402 Payment Required with the upgrade envelope when the plan limit is reached", async () => {
    // Finite test provider caps agents at 5; the org is already at 5 -> reject.
    prismaMock.organization.findUnique.mockResolvedValue({ plan: "DEFAULT" } as never);
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
      plan: "DEFAULT",
      limit: 5,
      current: 5,
      upgradeUrl: expect.stringContaining("vectorflow.sh"),
    });
    // Quota gate fires before the row is written.
    expect(prismaMock.vectorNode.create).not.toHaveBeenCalled();
  });
});
