import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mocks (must come before imports that use them) ─────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/pipeline-version", () => ({
  createVersion: vi.fn(),
  deployFromVersion: vi.fn(),
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

vi.mock("@/server/services/sse-broadcast", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("@/server/services/push-registry", () => ({
  pushRegistry: {
    send: vi.fn().mockReturnValue(true),
    broadcast: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("@/lib/config-generator", () => ({
  generateVectorYaml: vi.fn().mockReturnValue("mock: yaml"),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn().mockImplementation((_type: string, config: Record<string, unknown>) => config),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { StagedRolloutService } from "@/server/services/staged-rollout";
import { createVersion, deployFromVersion } from "@/server/services/pipeline-version";
import { fireEventAlert } from "@/server/services/event-alerts";
import { broadcastSSE } from "@/server/services/sse-broadcast";
import { pushRegistry } from "@/server/services/push-registry";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const createVersionMock = vi.mocked(createVersion);
const deployFromVersionMock = vi.mocked(deployFromVersion);
const fireEventAlertMock = vi.mocked(fireEventAlert);
const broadcastMock = vi.mocked(broadcastSSE);
const pushSendMock = vi.mocked(pushRegistry.send);

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-03-26T12:00:00Z");

function makeRollout(overrides: Record<string, unknown> = {}) {
  return {
    id: "rollout-1",
    pipelineId: "pipe-1",
    environmentId: "env-1",
    canaryVersionId: "ver-2",
    previousVersionId: "ver-1",
    canarySelector: { region: "us-east-1" },
    originalSelector: null,
    canaryNodeIds: ["node-1", "node-2"],
    remainingNodeIds: ["node-3", "node-4", "node-5"],
    status: "CANARY_DEPLOYED",
    healthCheckWindowMinutes: 5,
    healthCheckExpiresAt: new Date(NOW.getTime() + 5 * 60 * 1000),
    broadenedAt: null,
    rolledBackAt: null,
    createdById: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
    pipeline: { name: "My Pipeline", environmentId: "env-1" },
    canaryVersion: { createdById: "user-1" },
    ...overrides,
  };
}

function makePipeline(overrides: Record<string, unknown> = {}) {
  return {
    id: "pipe-1",
    name: "My Pipeline",
    environmentId: "env-1",
    nodeSelector: null,
    globalConfig: null,
    nodes: [
      {
        id: "pn-1",
        kind: "SOURCE",
        componentType: "stdin",
        componentKey: "in0",
        displayName: "stdin",
        config: {},
        positionX: 0,
        positionY: 0,
        disabled: false,
      },
    ],
    edges: [],
    environment: { id: "env-1", name: "Production" },
    ...overrides,
  };
}

function makeVectorNodes() {
  return [
    { id: "node-1", labels: { region: "us-east-1", tier: "canary" } },
    { id: "node-2", labels: { region: "us-east-1", tier: "prod" } },
    { id: "node-3", labels: { region: "us-west-2" } },
    { id: "node-4", labels: { region: "eu-west-1" } },
    { id: "node-5", labels: {} },
  ];
}

function makeVersions(count = 2) {
  if (count === 1) {
    return [{ id: "ver-1", version: 1 }];
  }
  return [
    { id: "ver-2", version: 2 },
    { id: "ver-1", version: 1 },
  ];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("StagedRolloutService", () => {
  let service: StagedRolloutService;

  beforeEach(() => {
    mockReset(prismaMock);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    service = new StagedRolloutService();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  // ─── createRollout ──────────────────────────────────────────────────

  describe("createRollout", () => {
    it("happy path: creates rollout, pushes to canary nodes only, fires SSE", async () => {
      // No existing active rollout
      prismaMock.stagedRollout.findFirst.mockResolvedValue(null as never);

      // Pipeline with environment
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);

      // 5 VectorNodes — 2 match canary selector { region: "us-east-1" }
      prismaMock.vectorNode.findMany.mockResolvedValue(makeVectorNodes() as never);

      // 2 PipelineVersions
      prismaMock.pipelineVersion.findMany.mockResolvedValue(makeVersions() as never);

      // createVersion returns a version object
      createVersionMock.mockResolvedValue({
        id: "ver-3",
        version: 3,
        configYaml: "mock: yaml",
      } as never);

      // StagedRollout.create returns a full record
      prismaMock.stagedRollout.create.mockResolvedValue(
        makeRollout({ id: "rollout-new", canaryVersionId: "ver-3" }) as never,
      );

      fireEventAlertMock.mockResolvedValue(undefined as never);

      const result = await service.createRollout(
        "pipe-1",
        "user-1",
        { region: "us-east-1" },
        5,
        "Test deploy",
      );

      // Returns rollout ID
      expect(result).toEqual({ rolloutId: "rollout-new" });

      // createVersion called once
      expect(createVersionMock).toHaveBeenCalledTimes(1);
      expect(createVersionMock).toHaveBeenCalledWith(
        "pipe-1",
        "mock: yaml",
        "user-1",
        "Test deploy",
        null, // logLevel (globalConfig is null so log_level is null)
        null, // globalConfig
        expect.any(Array), // nodesSnapshot
        expect.any(Array), // edgesSnapshot
      );

      // pushRegistry.send called for canary nodes ONLY (node-1 and node-2)
      expect(pushSendMock).toHaveBeenCalledTimes(2);
      expect(pushSendMock).toHaveBeenCalledWith(
        "node-1",
        expect.objectContaining({ type: "config_changed", pipelineId: "pipe-1", reason: "canary_deploy" }),
      );
      expect(pushSendMock).toHaveBeenCalledWith(
        "node-2",
        expect.objectContaining({ type: "config_changed", pipelineId: "pipe-1", reason: "canary_deploy" }),
      );

      // StagedRollout created with correct canaryNodeIds/remainingNodeIds
      expect(prismaMock.stagedRollout.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          pipelineId: "pipe-1",
          canaryVersionId: "ver-3",
          previousVersionId: "ver-1",
          canaryNodeIds: ["node-1", "node-2"],
          remainingNodeIds: ["node-3", "node-4", "node-5"],
          status: "CANARY_DEPLOYED",
          healthCheckWindowMinutes: 5,
        }),
      });

      // SSE broadcast fired
      expect(broadcastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pipeline_status",
          action: "canary_deployed",
          pipelineId: "pipe-1",
        }),
        "env-1",
      );

      // Event alert fired
      expect(fireEventAlertMock).toHaveBeenCalledWith(
        "deploy_completed",
        "env-1",
        expect.objectContaining({ pipelineId: "pipe-1" }),
      );
    });

    it("rejects when an active rollout already exists", async () => {
      prismaMock.stagedRollout.findFirst.mockResolvedValue(
        makeRollout() as never,
      );

      await expect(
        service.createRollout("pipe-1", "user-1", { region: "us-east-1" }, 5),
      ).rejects.toThrow("An active staged rollout already exists");

      // No version created
      expect(createVersionMock).not.toHaveBeenCalled();
    });

    it("creates rollout with previousVersionId=null on first deploy", async () => {
      prismaMock.stagedRollout.findFirst.mockResolvedValue(null as never);
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.vectorNode.findMany.mockResolvedValue(makeVectorNodes() as never);

      // Only 1 version exists (first deploy)
      prismaMock.pipelineVersion.findMany.mockResolvedValue(makeVersions(1) as never);

      createVersionMock.mockResolvedValue({
        id: "ver-2",
        version: 2,
        configYaml: "mock: yaml",
      } as never);

      prismaMock.stagedRollout.create.mockResolvedValue(
        makeRollout({ previousVersionId: null }) as never,
      );
      fireEventAlertMock.mockResolvedValue(undefined as never);

      await service.createRollout("pipe-1", "user-1", { region: "us-east-1" }, 5);

      // previousVersionId should be null
      expect(prismaMock.stagedRollout.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousVersionId: null,
        }),
      });
    });

    it("throws when no nodes match the canary selector", async () => {
      prismaMock.stagedRollout.findFirst.mockResolvedValue(null as never);
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);

      // All nodes have labels that DON'T match
      prismaMock.vectorNode.findMany.mockResolvedValue([
        { id: "node-1", labels: { region: "eu-central-1" } },
        { id: "node-2", labels: {} },
      ] as never);

      await expect(
        service.createRollout("pipe-1", "user-1", { region: "us-east-1" }, 5),
      ).rejects.toThrow("No nodes match the canary selector");
    });

    it("throws when pipeline is not found", async () => {
      prismaMock.stagedRollout.findFirst.mockResolvedValue(null as never);
      prismaMock.pipeline.findUnique.mockResolvedValue(null as never);

      await expect(
        service.createRollout("pipe-missing", "user-1", { region: "us-east-1" }, 5),
      ).rejects.toThrow("Pipeline not found");
    });
  });

  // ─── broadenRollout ─────────────────────────────────────────────────

  describe("broadenRollout", () => {
    it("happy path: pushes to remaining nodes, updates status to BROADENED", async () => {
      prismaMock.stagedRollout.findUnique.mockResolvedValue(
        makeRollout({ status: "HEALTH_CHECK" }) as never,
      );
      prismaMock.stagedRollout.update.mockResolvedValue({} as never);
      fireEventAlertMock.mockResolvedValue(undefined as never);

      await service.broadenRollout("rollout-1");

      // Push to remaining nodes (3 nodes)
      expect(pushSendMock).toHaveBeenCalledTimes(3);
      expect(pushSendMock).toHaveBeenCalledWith(
        "node-3",
        expect.objectContaining({ type: "config_changed", reason: "canary_broadened" }),
      );
      expect(pushSendMock).toHaveBeenCalledWith(
        "node-4",
        expect.objectContaining({ type: "config_changed", reason: "canary_broadened" }),
      );
      expect(pushSendMock).toHaveBeenCalledWith(
        "node-5",
        expect.objectContaining({ type: "config_changed", reason: "canary_broadened" }),
      );

      // Status updated to BROADENED with broadenedAt
      expect(prismaMock.stagedRollout.update).toHaveBeenCalledWith({
        where: { id: "rollout-1" },
        data: {
          status: "BROADENED",
          broadenedAt: expect.any(Date),
        },
      });

      // SSE broadcast fired
      expect(broadcastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pipeline_status",
          action: "canary_broadened",
          pipelineId: "pipe-1",
        }),
        "env-1",
      );
    });

    it("rejects when status is not HEALTH_CHECK", async () => {
      prismaMock.stagedRollout.findUnique.mockResolvedValue(
        makeRollout({ status: "CANARY_DEPLOYED" }) as never,
      );

      await expect(service.broadenRollout("rollout-1")).rejects.toThrow(
        'Cannot broaden rollout in status "CANARY_DEPLOYED"',
      );

      expect(pushSendMock).not.toHaveBeenCalled();
    });

    it("throws when rollout is not found", async () => {
      prismaMock.stagedRollout.findUnique.mockResolvedValue(null as never);

      await expect(service.broadenRollout("rollout-missing")).rejects.toThrow(
        "Staged rollout not found",
      );
    });
  });

  // ─── rollbackRollout ────────────────────────────────────────────────

  describe("rollbackRollout", () => {
    it("happy path: deploys previous version, sets ROLLED_BACK", async () => {
      prismaMock.stagedRollout.findUnique.mockResolvedValue(
        makeRollout({ status: "HEALTH_CHECK" }) as never,
      );
      deployFromVersionMock.mockResolvedValue({
        version: { id: "ver-1" } as never,
        pushedNodeIds: [],
      });
      prismaMock.stagedRollout.update.mockResolvedValue({} as never);
      fireEventAlertMock.mockResolvedValue(undefined as never);

      await service.rollbackRollout("rollout-1");

      // deployFromVersion called with previous version
      expect(deployFromVersionMock).toHaveBeenCalledWith(
        "pipe-1",
        "ver-1",
        "user-1",
        expect.stringContaining("Canary rollback"),
      );

      // Status updated to ROLLED_BACK with rolledBackAt
      expect(prismaMock.stagedRollout.update).toHaveBeenCalledWith({
        where: { id: "rollout-1" },
        data: {
          status: "ROLLED_BACK",
          rolledBackAt: expect.any(Date),
        },
      });

      // SSE broadcast fired
      expect(broadcastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pipeline_status",
          action: "canary_rolled_back",
          pipelineId: "pipe-1",
        }),
        "env-1",
      );
    });

    it("skips deployFromVersion when previousVersionId is null", async () => {
      prismaMock.stagedRollout.findUnique.mockResolvedValue(
        makeRollout({
          status: "HEALTH_CHECK",
          previousVersionId: null,
        }) as never,
      );
      prismaMock.stagedRollout.update.mockResolvedValue({} as never);
      fireEventAlertMock.mockResolvedValue(undefined as never);

      await service.rollbackRollout("rollout-1");

      // deployFromVersion NOT called
      expect(deployFromVersionMock).not.toHaveBeenCalled();

      // Status still updated to ROLLED_BACK
      expect(prismaMock.stagedRollout.update).toHaveBeenCalledWith({
        where: { id: "rollout-1" },
        data: {
          status: "ROLLED_BACK",
          rolledBackAt: expect.any(Date),
        },
      });
    });

    it("allows rollback from CANARY_DEPLOYED status (early rollback)", async () => {
      prismaMock.stagedRollout.findUnique.mockResolvedValue(
        makeRollout({ status: "CANARY_DEPLOYED" }) as never,
      );
      deployFromVersionMock.mockResolvedValue({
        version: { id: "ver-1" } as never,
        pushedNodeIds: [],
      });
      prismaMock.stagedRollout.update.mockResolvedValue({} as never);
      fireEventAlertMock.mockResolvedValue(undefined as never);

      await service.rollbackRollout("rollout-1");

      // deployFromVersion called — early rollback allowed
      expect(deployFromVersionMock).toHaveBeenCalledWith(
        "pipe-1",
        "ver-1",
        "user-1",
        expect.stringContaining("Canary rollback"),
      );

      expect(prismaMock.stagedRollout.update).toHaveBeenCalledWith({
        where: { id: "rollout-1" },
        data: {
          status: "ROLLED_BACK",
          rolledBackAt: expect.any(Date),
        },
      });
    });

    it("rejects rollback from BROADENED status", async () => {
      prismaMock.stagedRollout.findUnique.mockResolvedValue(
        makeRollout({ status: "BROADENED" }) as never,
      );

      await expect(service.rollbackRollout("rollout-1")).rejects.toThrow(
        'Cannot rollback rollout in status "BROADENED"',
      );

      expect(deployFromVersionMock).not.toHaveBeenCalled();
    });
  });

  // ─── checkHealthWindows ─────────────────────────────────────────────

  describe("checkHealthWindows", () => {
    it("transitions expired rollouts to HEALTH_CHECK", async () => {
      const expiredRollout1 = makeRollout({
        id: "rollout-1",
        healthCheckExpiresAt: new Date(NOW.getTime() - 60_000), // expired 1 min ago
      });
      const expiredRollout2 = makeRollout({
        id: "rollout-2",
        pipelineId: "pipe-2",
        healthCheckExpiresAt: new Date(NOW.getTime() - 120_000), // expired 2 min ago
        pipeline: { name: "Pipeline 2", environmentId: "env-2" },
      });

      prismaMock.stagedRollout.findMany.mockResolvedValue(
        [expiredRollout1, expiredRollout2] as never,
      );
      prismaMock.stagedRollout.update.mockResolvedValue({} as never);

      await service.checkHealthWindows();

      // Both updated to HEALTH_CHECK
      expect(prismaMock.stagedRollout.update).toHaveBeenCalledTimes(2);
      expect(prismaMock.stagedRollout.update).toHaveBeenCalledWith({
        where: { id: "rollout-1" },
        data: { status: "HEALTH_CHECK" },
      });
      expect(prismaMock.stagedRollout.update).toHaveBeenCalledWith({
        where: { id: "rollout-2" },
        data: { status: "HEALTH_CHECK" },
      });

      // SSE broadcast fired for each
      expect(broadcastMock).toHaveBeenCalledTimes(2);
      expect(broadcastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pipeline_status",
          action: "canary_health_check_ready",
          pipelineId: "pipe-1",
        }),
        "env-1",
      );
      expect(broadcastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pipeline_status",
          action: "canary_health_check_ready",
          pipelineId: "pipe-2",
        }),
        "env-2",
      );
    });

    it("does nothing when no rollouts have expired", async () => {
      prismaMock.stagedRollout.findMany.mockResolvedValue([] as never);

      await service.checkHealthWindows();

      expect(prismaMock.stagedRollout.update).not.toHaveBeenCalled();
      expect(broadcastMock).not.toHaveBeenCalled();
    });

    it("continues processing when one rollout update fails", async () => {
      const expiredRollout1 = makeRollout({
        id: "rollout-1",
        healthCheckExpiresAt: new Date(NOW.getTime() - 60_000),
      });
      const expiredRollout2 = makeRollout({
        id: "rollout-2",
        pipelineId: "pipe-2",
        healthCheckExpiresAt: new Date(NOW.getTime() - 120_000),
        pipeline: { name: "Pipeline 2", environmentId: "env-2" },
      });

      prismaMock.stagedRollout.findMany.mockResolvedValue(
        [expiredRollout1, expiredRollout2] as never,
      );

      // First update throws, second succeeds
      prismaMock.stagedRollout.update
        .mockRejectedValueOnce(new Error("DB error") as never)
        .mockResolvedValueOnce({} as never);

      await service.checkHealthWindows();

      // Both attempted
      expect(prismaMock.stagedRollout.update).toHaveBeenCalledTimes(2);
      // Only second broadcast fired (first failed before broadcast)
      expect(broadcastMock).toHaveBeenCalledTimes(1);
    });
  });

  // ─── start/stop lifecycle ───────────────────────────────────────────

  describe("start/stop lifecycle", () => {
    it("start() creates an interval that calls checkHealthWindows", () => {
      prismaMock.stagedRollout.findMany.mockResolvedValue([] as never);

      service.start();

      // Advance by one poll interval (30s)
      vi.advanceTimersByTime(30_000);

      expect(prismaMock.stagedRollout.findMany).toHaveBeenCalled();
    });

    it("stop() clears the interval", () => {
      prismaMock.stagedRollout.findMany.mockResolvedValue([] as never);

      service.start();
      service.stop();

      vi.advanceTimersByTime(60_000);

      expect(prismaMock.stagedRollout.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── auto-rollback integration ──────────────────────────────────────

  describe("auto-rollback integration", () => {
    it("auto-rollback marks active staged rollout as ROLLED_BACK", async () => {
      // Import auto-rollback service dynamically to get it with the same mocked prisma
      const { AutoRollbackService } = await import(
        "@/server/services/auto-rollback"
      );
      const arService = new AutoRollbackService();

      // Setup a pipeline with auto-rollback that exceeds threshold
      const pipeline = {
        id: "pipe-1",
        name: "My Pipeline",
        environmentId: "env-1",
        autoRollbackThreshold: 5.0,
        autoRollbackWindowMinutes: 5,
        deployedAt: new Date(NOW.getTime() - 2 * 60 * 1000), // 2 min ago
      };

      prismaMock.pipeline.findMany.mockResolvedValue([pipeline] as never);
      prismaMock.pipelineVersion.findMany.mockResolvedValue([
        { id: "ver-2", version: 2, createdById: "user-1" },
        { id: "ver-1", version: 1, createdById: "user-1" },
      ] as never);

      // 10% error rate — above 5% threshold
      prismaMock.nodePipelineStatus.findMany.mockResolvedValue([
        { eventsIn: BigInt(1000), errorsTotal: BigInt(100) },
      ] as never);

      deployFromVersionMock.mockResolvedValue({
        version: {} as never,
        pushedNodeIds: [],
      });
      prismaMock.pipeline.update.mockResolvedValue({} as never);

      // Active staged rollout exists for this pipeline
      const activeRollout = makeRollout({ id: "rollout-active" });
      prismaMock.stagedRollout.findFirst.mockResolvedValue(activeRollout as never);
      prismaMock.stagedRollout.update.mockResolvedValue({} as never);
      fireEventAlertMock.mockResolvedValue(undefined as never);

      await arService.checkPipelines();

      // Verify auto-rollback updated the staged rollout to ROLLED_BACK
      expect(prismaMock.stagedRollout.findFirst).toHaveBeenCalledWith({
        where: {
          pipelineId: "pipe-1",
          status: { in: ["CANARY_DEPLOYED", "HEALTH_CHECK"] },
        },
      });

      expect(prismaMock.stagedRollout.update).toHaveBeenCalledWith({
        where: { id: "rollout-active" },
        data: {
          status: "ROLLED_BACK",
          rolledBackAt: expect.any(Date),
        },
      });

      arService.stop();
    });
  });
});
