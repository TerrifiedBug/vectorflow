/**
 * Fleet router — comprehensive unit tests for procedures not covered by
 * the focused sub-files (fleet-list, fleet-matrix-summary, fleet-n1, fleet-heartbeat-runninguser).
 *
 * Covered here:
 *   get, getStatusTimeline, getUptime, create, update, delete,
 *   nodeLogs, nodeMetrics, revokeNode, triggerAgentUpdate,
 *   updateLabels, listLabels, setMaintenanceMode,
 *   listWithPipelineStatus,
 *   overview, volumeTrend, nodeThroughput, nodeCapacity, dataLoss, matrixThroughput
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: { isConnected: vi.fn(() => false), notify: vi.fn() },
}));

vi.mock("@/server/services/version-check", () => ({
  checkDevAgentVersion: vi.fn(),
}));

vi.mock("@/server/services/push-broadcast", () => ({
  relayPush: vi.fn(),
}));

vi.mock("@/server/services/fleet-data", () => ({
  getFleetOverview: vi.fn(),
  getVolumeTrend: vi.fn(),
  getNodeThroughput: vi.fn(),
  getNodeCapacity: vi.fn(),
  getDataLoss: vi.fn(),
  getMatrixThroughput: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { fleetRouter } from "@/server/routers/fleet";
import { relayPush } from "@/server/services/push-broadcast";
import { checkDevAgentVersion } from "@/server/services/version-check";
import {
  getFleetOverview,
  getVolumeTrend,
  getNodeThroughput,
  getNodeCapacity,
  getDataLoss,
  getMatrixThroughput,
} from "@/server/services/fleet-data";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(fleetRouter)({
  session: { user: { id: "user-1" } },
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "node-1",
    name: "alpha",
    host: "10.0.0.1",
    apiPort: 8686,
    environmentId: "env-1",
    status: "HEALTHY",
    labels: {},
    lastSeen: new Date(),
    metadata: null,
    nodeTokenHash: "hash-abc",
    enrolledAt: new Date(),
    lastHeartbeat: new Date(),
    agentVersion: "1.2.0",
    vectorVersion: "0.40.0",
    os: "linux",
    runningUser: null,
    deploymentMode: "STANDALONE",
    pendingAction: null,
    lastUpdateError: null,
    maintenanceMode: false,
    maintenanceModeAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

// ── fleet.get ─────────────────────────────────────────────────────────────────

describe("fleet.get", () => {
  it("returns node with currentStatusSince when a matching status event exists", async () => {
    const node = {
      ...makeNode(),
      environment: { id: "env-1", name: "Production" },
      pipelineStatuses: [],
    };
    const latestEvent = { timestamp: new Date("2024-01-01T00:00:00Z") };

    prismaMock.vectorNode.findUnique.mockResolvedValue(node as never);
    prismaMock.nodeStatusEvent.findFirst.mockResolvedValue(latestEvent as never);

    const result = await caller.get({ id: "node-1" });

    expect(result.id).toBe("node-1");
    expect(result.currentStatusSince).toEqual(latestEvent.timestamp);
  });

  it("returns currentStatusSince=null when no status event exists", async () => {
    const node = {
      ...makeNode(),
      environment: { id: "env-1", name: "Production" },
      pipelineStatuses: [],
    };

    prismaMock.vectorNode.findUnique.mockResolvedValue(node as never);
    prismaMock.nodeStatusEvent.findFirst.mockResolvedValue(null);

    const result = await caller.get({ id: "node-1" });

    expect(result.currentStatusSince).toBeNull();
  });

  it("throws NOT_FOUND when node does not exist", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(null);

    await expect(caller.get({ id: "missing-node" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ── fleet.getStatusTimeline ───────────────────────────────────────────────────

describe("fleet.getStatusTimeline", () => {
  it("returns events in range and current node status", async () => {
    const events = [
      { id: "evt-1", nodeId: "node-1", toStatus: "DEGRADED", timestamp: new Date() },
      { id: "evt-2", nodeId: "node-1", toStatus: "HEALTHY", timestamp: new Date() },
    ];

    prismaMock.nodeStatusEvent.findMany.mockResolvedValue(events as never);
    prismaMock.vectorNode.findUnique.mockResolvedValue({ status: "HEALTHY" } as never);

    const result = await caller.getStatusTimeline({ nodeId: "node-1", range: "1h" });

    expect(result.events).toHaveLength(2);
    expect(result.nodeStatus).toBe("HEALTHY");
  });

  it("returns UNKNOWN status when node does not exist", async () => {
    prismaMock.nodeStatusEvent.findMany.mockResolvedValue([]);
    prismaMock.vectorNode.findUnique.mockResolvedValue(null);

    const result = await caller.getStatusTimeline({ nodeId: "node-1", range: "6h" });

    expect(result.nodeStatus).toBe("UNKNOWN");
  });
});

// ── fleet.getUptime ───────────────────────────────────────────────────────────

describe("fleet.getUptime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports 100% uptime when node has been HEALTHY for entire range with no events", async () => {
    // Fix now so the range is fully deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T00:00:00.000Z"));

    prismaMock.nodeStatusEvent.findMany.mockResolvedValue([]);
    prismaMock.nodeStatusEvent.findFirst.mockResolvedValue(null);
    prismaMock.vectorNode.findUnique.mockResolvedValue({ status: "HEALTHY" } as never);

    const result = await caller.getUptime({ nodeId: "node-1", range: "1d" });

    expect(result.uptimePercent).toBe(100);
    expect(result.incidents).toBe(0);
  });

  it("calculates partial uptime correctly based on event timeline", async () => {
    // Fix now to epoch + 1 day so "since" is exactly epoch
    const nowMs = 86400000; // 1 day in ms
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));

    // Node was HEALTHY at start, DEGRADED at 12h, HEALTHY again at 18h
    const degradedAt = new Date(43200000); // 12h mark
    const healthyAgainAt = new Date(64800000); // 18h mark

    prismaMock.nodeStatusEvent.findMany.mockResolvedValue([
      { timestamp: degradedAt, toStatus: "DEGRADED" },
      { timestamp: healthyAgainAt, toStatus: "HEALTHY" },
    ] as never);
    prismaMock.nodeStatusEvent.findFirst.mockResolvedValue(null);
    prismaMock.vectorNode.findUnique.mockResolvedValue({ status: "HEALTHY" } as never);

    const result = await caller.getUptime({ nodeId: "node-1", range: "1d" });

    // Healthy 0→12h = 43200s; Healthy 18h→24h = 21600s; Total healthy = 64800s
    // Uptime = 64800/86400 = 75%
    expect(result.uptimePercent).toBe(75);
    expect(result.incidents).toBe(1);
    expect(result.healthySeconds).toBe(64800);
    expect(result.totalSeconds).toBe(86400);
  });

  it("uses priorEvent status as starting point when available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(86400000));

    // Node was DEGRADED before range → HEALTHY at 6h mark
    const healthyAt = new Date(21600000); // 6h mark

    prismaMock.nodeStatusEvent.findMany.mockResolvedValue([
      { timestamp: healthyAt, toStatus: "HEALTHY" },
    ] as never);
    prismaMock.nodeStatusEvent.findFirst.mockResolvedValue({ toStatus: "DEGRADED" } as never);
    prismaMock.vectorNode.findUnique.mockResolvedValue({ status: "HEALTHY" } as never);

    const result = await caller.getUptime({ nodeId: "node-1", range: "1d" });

    // DEGRADED 0→6h = 21600s not counted; HEALTHY 6h→24h = 64800s
    expect(result.healthySeconds).toBe(64800);
    expect(result.uptimePercent).toBe(75);
  });
});

// ── fleet.create ──────────────────────────────────────────────────────────────

describe("fleet.create", () => {
  it("creates a node when environment exists", async () => {
    const env = { id: "env-1", name: "Production" };
    const created = {
      ...makeNode({ name: "new-node", host: "10.0.1.2" }),
      environment: env,
    };

    prismaMock.environment.findUnique.mockResolvedValue(env as never);
    prismaMock.vectorNode.create.mockResolvedValue(created as never);

    const result = await caller.create({
      name: "new-node",
      host: "10.0.1.2",
      apiPort: 8686,
      environmentId: "env-1",
    });

    expect(result.name).toBe("new-node");
    expect(prismaMock.vectorNode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "new-node", host: "10.0.1.2" }),
      }),
    );
  });

  it("throws NOT_FOUND when environment does not exist", async () => {
    prismaMock.environment.findUnique.mockResolvedValue(null);

    await expect(
      caller.create({ name: "n", host: "10.0.0.1", apiPort: 8686, environmentId: "missing-env" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(prismaMock.vectorNode.create).not.toHaveBeenCalled();
  });
});

// ── fleet.update ──────────────────────────────────────────────────────────────

describe("fleet.update", () => {
  it("updates node name when node exists", async () => {
    const existing = makeNode();
    const updated = { ...existing, name: "renamed", environment: { id: "env-1", name: "Prod" } };

    prismaMock.vectorNode.findUnique.mockResolvedValue(existing as never);
    prismaMock.vectorNode.update.mockResolvedValue(updated as never);

    const result = await caller.update({ id: "node-1", name: "renamed" });

    expect(result.name).toBe("renamed");
    expect(prismaMock.vectorNode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "node-1" } }),
    );
  });

  it("throws NOT_FOUND when node does not exist", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(null);

    await expect(caller.update({ id: "missing", name: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ── fleet.delete ──────────────────────────────────────────────────────────────

describe("fleet.delete", () => {
  it("deletes node when it exists", async () => {
    const existing = makeNode();

    prismaMock.vectorNode.findUnique.mockResolvedValue(existing as never);
    prismaMock.vectorNode.delete.mockResolvedValue(existing as never);

    await caller.delete({ id: "node-1" });

    expect(prismaMock.vectorNode.delete).toHaveBeenCalledWith({ where: { id: "node-1" } });
  });

  it("throws NOT_FOUND when node does not exist", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(null);

    await expect(caller.delete({ id: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ── fleet.nodeLogs ────────────────────────────────────────────────────────────

describe("fleet.nodeLogs", () => {
  it("returns items and no nextCursor when results fit within limit", async () => {
    const logs = Array.from({ length: 5 }, (_, i) => ({
      id: `log-${i}`,
      nodeId: "node-1",
      node: { name: "alpha" },
      pipeline: null,
    }));

    prismaMock.pipelineLog.findMany.mockResolvedValue(logs as never);

    const result = await caller.nodeLogs({ nodeId: "node-1", limit: 10 });

    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns nextCursor when there are more items than the limit", async () => {
    // Router fetches limit+1 to determine if there is a next page
    const logs = Array.from({ length: 11 }, (_, i) => ({
      id: `log-${i}`,
      nodeId: "node-1",
      node: { name: "alpha" },
      pipeline: null,
    }));

    prismaMock.pipelineLog.findMany.mockResolvedValue(logs as never);

    const result = await caller.nodeLogs({ nodeId: "node-1", limit: 10 });

    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBe("log-10");
  });

  it("passes pipelineId filter to Prisma when provided", async () => {
    prismaMock.pipelineLog.findMany.mockResolvedValue([]);

    await caller.nodeLogs({ nodeId: "node-1", pipelineId: "pipe-1", limit: 50 });

    expect(prismaMock.pipelineLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pipelineId: "pipe-1" }),
      }),
    );
  });
});

// ── fleet.nodeMetrics ─────────────────────────────────────────────────────────

describe("fleet.nodeMetrics", () => {
  it("queries metrics within the specified time range", async () => {
    prismaMock.nodeMetric.findMany.mockResolvedValue([]);

    await caller.nodeMetrics({ nodeId: "node-1", hours: 3 });

    expect(prismaMock.nodeMetric.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ nodeId: "node-1" }),
        orderBy: { timestamp: "asc" },
      }),
    );
  });

  it("returns metric rows ordered by timestamp asc", async () => {
    const metrics = [
      { timestamp: new Date("2024-01-01T00:00:00Z"), memoryUsedBytes: 100 },
      { timestamp: new Date("2024-01-01T01:00:00Z"), memoryUsedBytes: 200 },
    ];
    prismaMock.nodeMetric.findMany.mockResolvedValue(metrics as never);

    const result = await caller.nodeMetrics({ nodeId: "node-1", hours: 2 });

    expect(result).toHaveLength(2);
  });
});

// ── fleet.revokeNode ──────────────────────────────────────────────────────────

describe("fleet.revokeNode", () => {
  it("clears nodeTokenHash and sets status to UNREACHABLE", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(makeNode() as never);
    prismaMock.vectorNode.update.mockResolvedValue(
      makeNode({ nodeTokenHash: null, status: "UNREACHABLE" }) as never,
    );

    await caller.revokeNode({ id: "node-1" });

    expect(prismaMock.vectorNode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "node-1" },
        data: { nodeTokenHash: null, status: "UNREACHABLE" },
      }),
    );
  });

  it("throws NOT_FOUND when node does not exist", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(null);

    await expect(caller.revokeNode({ id: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ── fleet.triggerAgentUpdate ──────────────────────────────────────────────────

describe("fleet.triggerAgentUpdate", () => {
  const baseInput = {
    nodeId: "node-1",
    targetVersion: "1.5.0",
    downloadUrl: "https://releases.example.com/vf-agent-linux-amd64",
    checksum: "sha256:abc123",
  };

  it("throws NOT_FOUND when node does not exist", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(null);

    await expect(caller.triggerAgentUpdate(baseInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws BAD_REQUEST for DOCKER deployment mode", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(
      makeNode({ deploymentMode: "DOCKER" }) as never,
    );

    await expect(caller.triggerAgentUpdate(baseInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("stores pendingAction and relays push for stable release", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(makeNode() as never);
    prismaMock.vectorNode.update.mockResolvedValue(makeNode() as never);

    await caller.triggerAgentUpdate(baseInput);

    expect(prismaMock.vectorNode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pendingAction: expect.objectContaining({
            type: "self_update",
            targetVersion: "1.5.0",
          }),
        }),
      }),
    );
    expect(relayPush).toHaveBeenCalledWith(
      "node-1",
      expect.objectContaining({ type: "action", action: "self_update" }),
    );
  });

  it("throws INTERNAL_SERVER_ERROR when dev release info is unavailable", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(makeNode() as never);
    (checkDevAgentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ latestVersion: null, checksums: {} });

    await expect(
      caller.triggerAgentUpdate({
        ...baseInput,
        targetVersion: "dev-abc123",
        downloadUrl: "https://releases.example.com/vf-agent-linux-amd64",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("uses fresh version/checksum for dev releases", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(makeNode() as never);
    prismaMock.vectorNode.update.mockResolvedValue(makeNode() as never);

    (checkDevAgentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      latestVersion: "dev-fresh999",
      checksums: { "vf-agent-linux-amd64": "freshchecksum" },
    });

    await caller.triggerAgentUpdate({
      ...baseInput,
      targetVersion: "dev-old",
      downloadUrl: "https://releases.example.com/vf-agent-linux-amd64",
    });

    expect(prismaMock.vectorNode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pendingAction: expect.objectContaining({
            targetVersion: "dev-fresh999",
            checksum: "sha256:freshchecksum",
          }),
        }),
      }),
    );
  });
});

// ── fleet bulk agent upgrades ────────────────────────────────────────────────

describe("fleet.previewAgentUpgrade", () => {
  it("builds a staged upgrade plan with risk and blocked-node counts", async () => {
    prismaMock.nodeGroup.findUnique.mockResolvedValue({
      id: "group-1",
      name: "Edge collectors",
      environmentId: "env-1",
      criteria: { tier: "edge" },
    } as never);
    prismaMock.vectorNode.findMany.mockResolvedValue([
      makeNode({ id: "node-1", name: "alpha", agentVersion: "1.0.0", labels: { tier: "edge", zone: "a" } }),
      makeNode({ id: "node-2", name: "bravo", agentVersion: "1.1.0", status: "DEGRADED", labels: { tier: "edge", zone: "b" } }),
      makeNode({ id: "node-3", name: "charlie", agentVersion: "1.0.0", deploymentMode: "DOCKER", labels: { tier: "edge" } }),
      makeNode({ id: "node-4", name: "delta", agentVersion: "2.0.0", labels: { tier: "edge" } }),
      makeNode({ id: "node-5", name: "echo", agentVersion: "1.0.0", pendingAction: { type: "self_update" }, labels: { tier: "edge" } }),
    ] as never);

    const result = await caller.previewAgentUpgrade({
      environmentId: "env-1",
      targetVersion: "2.0.0",
      selector: { nodeGroupId: "group-1" },
      canaryNodeIds: ["node-2"],
      waveSize: 1,
    });

    expect(result.summary).toMatchObject({
      totalMatched: 5,
      eligible: 2,
      blockedDocker: 1,
      blockedAlreadyCurrent: 1,
      blockedPendingAction: 1,
      blockedUnreachable: 0,
      risk: "medium",
    });
    expect(result.waves).toEqual([
      expect.objectContaining({ stage: "canary", nodeIds: ["node-2"] }),
      expect.objectContaining({ stage: "wave", nodeIds: ["node-1"] }),
    ]);
  });

  it("marks maintenance windows that are not currently open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T10:00:00.000Z"));
    prismaMock.vectorNode.findMany.mockResolvedValue([
      makeNode({ id: "node-1", agentVersion: "1.0.0" }),
    ] as never);

    const result = await caller.previewAgentUpgrade({
      environmentId: "env-1",
      targetVersion: "2.0.0",
      maintenanceWindow: {
        startAt: "2026-05-03T11:00:00.000Z",
        endAt: "2026-05-03T12:00:00.000Z",
      },
    });

    expect(result.maintenanceWindow?.status).toBe("scheduled");
    vi.useRealTimers();
  });

  it("treats empty selector nodeIds as no explicit ID filter", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      makeNode({ id: "node-1", labels: { tier: "edge" }, agentVersion: "1.0.0" }),
      makeNode({ id: "node-2", labels: { tier: "edge" }, agentVersion: "1.0.0" }),
    ] as never);

    const result = await caller.previewAgentUpgrade({
      environmentId: "env-1",
      targetVersion: "2.0.0",
      selector: {
        nodeIds: [],
        labels: { tier: "edge" },
      },
    });

    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          id: expect.anything(),
        }),
      }),
    );
    expect(result.summary.totalMatched).toBe(2);
    expect(result.summary.eligible).toBe(2);
  });
});

describe("fleet.triggerBulkAgentUpdate", () => {
  const baseInput = {
    environmentId: "env-1",
    targetVersion: "2.0.0",
    downloadUrl: "https://releases.example.com/vf-agent-linux-amd64",
    checksum: "sha256:abc123",
    waveSize: 2,
  };

  it("rejects updates outside the requested maintenance window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T10:00:00.000Z"));

    await expect(
      caller.triggerBulkAgentUpdate({
        ...baseInput,
        maintenanceWindow: {
          startAt: "2026-05-03T11:00:00.000Z",
          endAt: "2026-05-03T12:00:00.000Z",
        },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(prismaMock.vectorNode.updateMany).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("updates only the canary wave and returns remaining waves", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      makeNode({ id: "node-1", name: "alpha", agentVersion: "1.0.0" }),
      makeNode({ id: "node-2", name: "bravo", agentVersion: "1.0.0" }),
      makeNode({ id: "node-3", name: "charlie", agentVersion: "1.0.0" }),
    ] as never);
    prismaMock.vectorNode.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await caller.triggerBulkAgentUpdate({
      ...baseInput,
      canaryNodeIds: ["node-2"],
    });

    expect(result.triggeredNodeIds).toEqual(["node-2"]);
    expect(result.remainingNodeIds).toEqual(["node-1", "node-3"]);
    expect(prismaMock.vectorNode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["node-2"] } },
        data: {
          pendingAction: expect.objectContaining({
            type: "self_update",
            targetVersion: "2.0.0",
            orchestration: expect.objectContaining({
              environmentId: "env-1",
              stage: "canary",
              waveIndex: 0,
              totalWaves: 2,
            }),
          }),
        },
      }),
    );
    expect(relayPush).toHaveBeenCalledWith(
      "node-2",
      expect.objectContaining({ type: "action", action: "self_update", targetVersion: "2.0.0" }),
    );
  });
});

describe("fleet.triggerAgentUpdates", () => {
  it("triggers self_update for every eligible node ID in the request", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      makeNode({ id: "node-1", agentVersion: "1.0.0" }),
      makeNode({ id: "node-2", agentVersion: "1.1.0" }),
    ] as never);
    prismaMock.vectorNode.updateMany.mockResolvedValue({ count: 2 } as never);

    const result = await caller.triggerAgentUpdates({
      environmentId: "env-1",
      nodeIds: ["node-1", "node-2"],
      targetVersion: "2.0.0",
      downloadUrl: "https://releases.example.com/vf-agent-linux-amd64",
      checksum: "sha256:abc123",
    });

    expect(result.triggeredNodeIds).toEqual(["node-1", "node-2"]);
    expect(result.skipped).toEqual([]);
    expect(prismaMock.vectorNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["node-1", "node-2"] }, environmentId: "env-1" },
      }),
    );
    expect(prismaMock.vectorNode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["node-1", "node-2"] } },
        data: {
          pendingAction: expect.objectContaining({
            type: "self_update",
            targetVersion: "2.0.0",
          }),
        },
      }),
    );
    expect(relayPush).toHaveBeenCalledTimes(2);
  });

  it("refreshes dev metadata and uses fresh version/checksum for dev- targets", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      makeNode({ id: "node-1", agentVersion: "dev-old" }),
    ] as never);
    prismaMock.vectorNode.updateMany.mockResolvedValue({ count: 1 } as never);
    vi.mocked(checkDevAgentVersion).mockResolvedValue({
      latestVersion: "dev-20260503",
      checksums: { "vf-agent-linux-amd64": "freshchecksum" },
    } as never);

    const result = await caller.triggerAgentUpdates({
      environmentId: "env-1",
      nodeIds: ["node-1"],
      targetVersion: "dev-20260101",
      downloadUrl: "https://releases.example.com/vf-agent-linux-amd64",
      checksum: "sha256:stale",
    });

    expect(result.triggeredNodeIds).toEqual(["node-1"]);
    expect(checkDevAgentVersion).toHaveBeenCalledWith(true);
    expect(prismaMock.vectorNode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          pendingAction: expect.objectContaining({
            targetVersion: "dev-20260503",
            checksum: "sha256:freshchecksum",
          }),
        },
      }),
    );
  });

  it("recomputes eligibility after refreshing a dev target version", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      makeNode({ id: "node-1", agentVersion: "dev-20260503" }),
    ] as never);
    vi.mocked(checkDevAgentVersion).mockResolvedValue({
      latestVersion: "dev-20260503",
      checksums: { "vf-agent-linux-amd64": "freshchecksum" },
    } as never);

    const result = await caller.triggerAgentUpdates({
      environmentId: "env-1",
      nodeIds: ["node-1"],
      targetVersion: "dev-20260101",
      downloadUrl: "https://releases.example.com/vf-agent-linux-amd64",
      checksum: "sha256:stale",
    });

    expect(checkDevAgentVersion).toHaveBeenCalledWith(true);
    expect(result.updatedCount).toBe(0);
    expect(result.triggeredNodeIds).toEqual([]);
    expect(result.skipped).toEqual([{ nodeId: "node-1", reason: "already_current" }]);
    expect(prismaMock.vectorNode.updateMany).not.toHaveBeenCalled();
    expect(relayPush).not.toHaveBeenCalled();
  });

  it("skips Docker, unreachable, pending, and already-current nodes", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      makeNode({ id: "node-1", agentVersion: "1.0.0", deploymentMode: "DOCKER" }),
      makeNode({ id: "node-2", agentVersion: "1.0.0", status: "UNREACHABLE" }),
      makeNode({ id: "node-3", agentVersion: "1.0.0", pendingAction: { type: "self_update" } }),
      makeNode({ id: "node-4", agentVersion: "2.0.0" }),
    ] as never);

    const result = await caller.triggerAgentUpdates({
      environmentId: "env-1",
      nodeIds: ["node-1", "node-2", "node-3", "node-4"],
      targetVersion: "2.0.0",
      downloadUrl: "https://releases.example.com/vf-agent-linux-amd64",
      checksum: "sha256:abc123",
    });

    expect(result.triggeredNodeIds).toEqual([]);
    expect(result.skipped.map((item: { reason: string }) => item.reason)).toEqual([
      "docker",
      "unreachable",
      "pending_action",
      "already_current",
    ]);
    expect(prismaMock.vectorNode.updateMany).not.toHaveBeenCalled();
    expect(relayPush).not.toHaveBeenCalled();
  });
});

describe("fleet.agentDriftReport", () => {
  it("reports fleet-wide agent version drift for an environment", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      makeNode({ id: "node-1", name: "alpha", agentVersion: "1.0.0" }),
      makeNode({ id: "node-2", name: "bravo", agentVersion: "2.0.0" }),
      makeNode({ id: "node-3", name: "charlie", agentVersion: null }),
      makeNode({ id: "node-4", name: "delta", agentVersion: "1.0.0", deploymentMode: "DOCKER" }),
    ] as never);

    const result = await caller.agentDriftReport({
      environmentId: "env-1",
      targetVersion: "2.0.0",
    });

    expect(result.summary).toEqual({
      total: 4,
      behind: 2,
      current: 1,
      unknown: 1,
      docker: 1,
    });
    expect(result.nodes.map((node: { id: string; drift: string }) => ({ id: node.id, drift: node.drift }))).toEqual([
      { id: "node-1", drift: "behind" },
      { id: "node-2", drift: "current" },
      { id: "node-3", drift: "unknown" },
      { id: "node-4", drift: "behind" },
    ]);
  });
});

// ── fleet.updateLabels ────────────────────────────────────────────────────────

describe("fleet.updateLabels", () => {
  it("updates labels for the given node", async () => {
    const labels = { region: "us-east", role: "worker" };
    prismaMock.vectorNode.update.mockResolvedValue(makeNode({ labels }) as never);

    await caller.updateLabels({ nodeId: "node-1", labels });

    expect(prismaMock.vectorNode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "node-1" },
        data: { labels },
      }),
    );
  });
});

// ── fleet.listLabels ──────────────────────────────────────────────────────────

describe("fleet.listLabels", () => {
  it("aggregates label keys and deduplicates/sorts values", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { labels: { region: "us-east", role: "worker" } },
      { labels: { region: "eu-west", role: "worker" } },
      { labels: { region: "us-east" } },
    ] as never);

    const result = await caller.listLabels({ environmentId: "env-1" });

    expect(result.region).toEqual(["eu-west", "us-east"]); // sorted, deduplicated
    expect(result.role).toEqual(["worker"]);
  });

  it("returns empty object when no nodes have labels", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      { labels: {} },
      { labels: null },
    ] as never);

    const result = await caller.listLabels({ environmentId: "env-1" });

    expect(result).toEqual({});
  });
});

// ── fleet.setMaintenanceMode ──────────────────────────────────────────────────

describe("fleet.setMaintenanceMode", () => {
  it("enables maintenance mode and sends config_changed push", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(makeNode() as never);
    prismaMock.vectorNode.update.mockResolvedValue(
      makeNode({ maintenanceMode: true }) as never,
    );

    const result = await caller.setMaintenanceMode({ nodeId: "node-1", enabled: true });

    expect(prismaMock.vectorNode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ maintenanceMode: true }),
      }),
    );
    expect(relayPush).toHaveBeenCalledWith(
      "node-1",
      expect.objectContaining({ type: "config_changed", reason: "maintenance_on" }),
    );
    expect(result.maintenanceMode).toBe(true);
  });

  it("disables maintenance mode and sends config_changed push", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(
      makeNode({ maintenanceMode: true }) as never,
    );
    prismaMock.vectorNode.update.mockResolvedValue(makeNode({ maintenanceMode: false }) as never);

    await caller.setMaintenanceMode({ nodeId: "node-1", enabled: false });

    expect(relayPush).toHaveBeenCalledWith(
      "node-1",
      expect.objectContaining({ reason: "maintenance_off" }),
    );
  });

  it("throws NOT_FOUND when node does not exist", async () => {
    prismaMock.vectorNode.findUnique.mockResolvedValue(null);

    await expect(
      caller.setMaintenanceMode({ nodeId: "missing", enabled: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ── fleet.listWithPipelineStatus ──────────────────────────────────────────────

describe("fleet.listWithPipelineStatus", () => {
  it("returns nodes with pushConnected flag and deployed pipelines list", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([
      {
        id: "node-1",
        name: "alpha",
        pipelineStatuses: [],
      },
    ] as never);

    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipe-1",
        name: "access-logs",
        tags: ["prod"],
        versions: [{ version: 3 }],
      },
    ] as never);

    const result = await caller.listWithPipelineStatus({ environmentId: "env-1" });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toHaveProperty("pushConnected", false);
    expect(result.deployedPipelines).toHaveLength(1);
    expect(result.deployedPipelines[0]).toMatchObject({
      id: "pipe-1",
      latestVersion: 3,
      tags: ["prod"],
    });
  });

  it("returns latestVersion=1 when pipeline has no versions", async () => {
    prismaMock.vectorNode.findMany.mockResolvedValue([]);
    prismaMock.pipeline.findMany.mockResolvedValue([
      { id: "pipe-1", name: "new-pipe", tags: [], versions: [] },
    ] as never);

    const result = await caller.listWithPipelineStatus({ environmentId: "env-1" });

    expect(result.deployedPipelines[0].latestVersion).toBe(1);
  });
});

// ── fleet analytics — delegation tests ───────────────────────────────────────

describe("fleet.overview", () => {
  it("delegates to getFleetOverview with correct args", async () => {
    const mockData = { totalNodes: 3, healthyNodes: 2 };
    (getFleetOverview as ReturnType<typeof vi.fn>).mockResolvedValue(mockData);

    const result = await caller.overview({ environmentId: "env-1", range: "7d" });

    expect(getFleetOverview).toHaveBeenCalledWith("env-1", "7d");
    expect(result).toEqual(mockData);
  });
});

describe("fleet.volumeTrend", () => {
  it("delegates to getVolumeTrend with correct args", async () => {
    (getVolumeTrend as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await caller.volumeTrend({ environmentId: "env-1", range: "1h" });

    expect(getVolumeTrend).toHaveBeenCalledWith("env-1", "1h");
  });
});

describe("fleet.nodeThroughput", () => {
  it("delegates to getNodeThroughput with correct args", async () => {
    (getNodeThroughput as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await caller.nodeThroughput({ environmentId: "env-1", range: "1d" });

    expect(getNodeThroughput).toHaveBeenCalledWith("env-1", "1d");
  });
});

describe("fleet.nodeCapacity", () => {
  it("delegates to getNodeCapacity with correct args", async () => {
    (getNodeCapacity as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await caller.nodeCapacity({ environmentId: "env-1", range: "6h" });

    expect(getNodeCapacity).toHaveBeenCalledWith("env-1", "6h");
  });
});

describe("fleet.dataLoss", () => {
  it("delegates to getDataLoss with threshold", async () => {
    (getDataLoss as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await caller.dataLoss({ environmentId: "env-1", range: "30d", threshold: 0.1 });

    expect(getDataLoss).toHaveBeenCalledWith("env-1", "30d", 0.1);
  });
});

describe("fleet.matrixThroughput", () => {
  it("delegates to getMatrixThroughput with correct args", async () => {
    (getMatrixThroughput as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await caller.matrixThroughput({ environmentId: "env-1", range: "1d" });

    expect(getMatrixThroughput).toHaveBeenCalledWith("env-1", "1d");
  });
});
