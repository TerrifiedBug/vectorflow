import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mock dependencies before importing SUT ─────────────────────────────────

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
    vi.mocked(generateNodeToken).mockResolvedValue({ token: "vf_node_abc123", hash: "h-abc" });
    prismaMock.environment.findMany.mockResolvedValue([mockEnv] as never);
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
