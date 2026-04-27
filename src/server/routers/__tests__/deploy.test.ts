import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── vi.hoisted so `t` is available inside vi.mock factories ────────────────

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
    requireSuperAdmin: passthrough,
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

vi.mock("@/server/services/deploy-agent", () => ({
  deployAgent: vi.fn(),
  undeployAgent: vi.fn(),
}));

vi.mock("@/server/services/pipeline-version", () => ({
  deployFromVersion: vi.fn(),
}));

vi.mock("@/lib/config-generator", () => ({
  generateVectorYaml: vi.fn().mockReturnValue("sources:\n  my_source:\n    type: stdin\n"),
}));

vi.mock("@/server/services/validator", () => ({
  validateConfig: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn((_: unknown, c: unknown) => c),
}));

vi.mock("@/server/services/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

vi.mock("@/server/services/push-broadcast", () => ({
  relayPush: vi.fn(),
}));

vi.mock("@/server/services/sse-broadcast", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("@/lib/deployment-strategy", () => ({
  parseDeploymentStrategy: vi.fn().mockReturnValue(null),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { deployRouter } from "@/server/routers/deploy";
import * as deployAgentModule from "@/server/services/deploy-agent";
import * as pipelineVersionModule from "@/server/services/pipeline-version";
import * as pushBroadcast from "@/server/services/push-broadcast";
import * as eventAlerts from "@/server/services/event-alerts";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(deployRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

const editorCaller = t.createCallerFactory(deployRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "EDITOR",
  teamId: "team-1",
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePipeline(overrides: Record<string, unknown> = {}) {
  return {
    id: "pipeline-1",
    name: "My Pipeline",
    environmentId: "env-1",
    enrichMetadata: false,
    globalConfig: null,
    deploymentStrategy: null,
    nodeSelector: null,
    nodes: [
      {
        id: "node-1",
        kind: "SOURCE",
        componentType: "stdin",
        componentKey: "my_source",
        config: {},
        positionX: 0,
        positionY: 0,
        disabled: false,
      },
    ],
    edges: [],
    environment: { id: "env-1", name: "Development", requireDeployApproval: false },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("deploy router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── preview ────────────────────────────────────────────────────────────────

  describe("preview", () => {
    it("returns config YAML and validation result for a pipeline", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.pipelineVersion.findFirst.mockResolvedValue(null);

      const result = await caller.preview({ pipelineId: "pipeline-1" });

      expect(result.configYaml).toBeDefined();
      expect(result.validation).toEqual({ valid: true, errors: [] });
      expect(result.currentConfigYaml).toBeNull();
      expect(result.currentVersion).toBeNull();
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null);

      await expect(
        caller.preview({ pipelineId: "nonexistent" }),
      ).rejects.toThrow("Pipeline not found");
    });

    it("includes current version info when a version exists", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.pipelineVersion.findFirst.mockResolvedValue({
        configYaml: "old yaml",
        version: 3,
        logLevel: "debug",
      } as never);

      const result = await caller.preview({ pipelineId: "pipeline-1" });

      expect(result.currentConfigYaml).toBe("old yaml");
      expect(result.currentVersion).toBe(3);
      expect(result.currentLogLevel).toBe("debug");
    });
  });

  // ─── agent (deploy) ────────────────────────────────────────────────────────

  describe("agent", () => {
    it("deploys successfully and returns result", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      vi.mocked(deployAgentModule.deployAgent).mockResolvedValue({
        success: true,
        version: { id: "v1", version: 1 },
        pushedNodeIds: ["node-a"],
      } as never);

      const result = await caller.agent({
        pipelineId: "pipeline-1",
        changelog: "initial deploy",
      });

      expect(result.success).toBe(true);
      expect(deployAgentModule.deployAgent).toHaveBeenCalledWith(
        "pipeline-1",
        "user-1",
        "initial deploy",
      );
    });

    it("creates pending approval when environment requires it and user is EDITOR", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(
        makePipeline({
          environment: { id: "env-1", name: "Production", requireDeployApproval: true },
        }) as never,
      );
      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
        const tx = {
          deployRequest: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({
              id: "req-1",
              pipelineId: "pipeline-1",
              status: "PENDING",
            }),
          },
        };
        return fn(tx);
      });

      const result = await editorCaller.agent({
        pipelineId: "pipeline-1",
        changelog: "needs approval",
      });

      expect(result.pendingApproval).toBe(true);
      expect(result.requestId).toBe("req-1");
      expect(deployAgentModule.deployAgent).not.toHaveBeenCalled();
    });

    it("throws CONFLICT when a pending deploy request already exists", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(
        makePipeline({
          environment: { id: "env-1", name: "Production", requireDeployApproval: true },
        }) as never,
      );
      prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn !== "function") return;
        const tx = {
          deployRequest: {
            findFirst: vi.fn().mockResolvedValue({ id: "existing-req" }),
            create: vi.fn(),
          },
        };
        return fn(tx);
      });

      await expect(
        editorCaller.agent({
          pipelineId: "pipeline-1",
          changelog: "duplicate",
        }),
      ).rejects.toThrow("pending deploy request already exists");
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null);

      await expect(
        caller.agent({ pipelineId: "nonexistent", changelog: "test" }),
      ).rejects.toThrow("Pipeline not found");
    });

    it("persists nodeSelector on successful deploy", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      vi.mocked(deployAgentModule.deployAgent).mockResolvedValue({
        success: true,
        version: { id: "v1", version: 1 },
        pushedNodeIds: [],
      } as never);
      prismaMock.pipeline.update.mockResolvedValue({} as never);

      await caller.agent({
        pipelineId: "pipeline-1",
        changelog: "with selector",
        nodeSelector: { region: "us-east" },
      });

      expect(prismaMock.pipeline.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pipeline-1" },
          data: { nodeSelector: { region: "us-east" } },
        }),
      );
    });
  });

  // ─── undeploy ──────────────────────────────────────────────────────────────

  describe("undeploy", () => {
    it("undeploys and notifies connected agents on success", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(
        makePipeline() as never,
      );
      vi.mocked(deployAgentModule.undeployAgent).mockResolvedValue({
        success: true,
      } as never);
      prismaMock.vectorNode.findMany.mockResolvedValue([
        { id: "agent-1" },
        { id: "agent-2" },
      ] as never);

      const result = await caller.undeploy({ pipelineId: "pipeline-1" });

      expect(result.success).toBe(true);
      expect(pushBroadcast.relayPush).toHaveBeenCalledTimes(2);
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null);

      await expect(
        caller.undeploy({ pipelineId: "nonexistent" }),
      ).rejects.toThrow("Pipeline not found");
    });
  });

  // ─── deployFromVersion ─────────────────────────────────────────────────────

  describe("deployFromVersion", () => {
    it("deploys from a historical version and returns result", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      vi.mocked(pipelineVersionModule.deployFromVersion).mockResolvedValue({
        version: { id: "v2", version: 2 },
        pushedNodeIds: ["agent-1"],
      } as never);

      const result = await caller.deployFromVersion({
        pipelineId: "pipeline-1",
        sourceVersionId: "v1",
        changelog: "rollback",
      });

      expect(result.success).toBe(true);
      expect(result.version).toEqual({ id: "v2", version: 2 });
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null);

      await expect(
        caller.deployFromVersion({
          pipelineId: "nonexistent",
          sourceVersionId: "v1",
        }),
      ).rejects.toThrow("Pipeline not found");
    });

    it("throws FORBIDDEN when approval required and user is EDITOR", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(
        makePipeline({
          environment: { id: "env-1", name: "Production", requireDeployApproval: true },
        }) as never,
      );

      await expect(
        editorCaller.deployFromVersion({
          pipelineId: "pipeline-1",
          sourceVersionId: "v1",
        }),
      ).rejects.toThrow("Deploy approval is required");
    });
  });

  // ─── environmentInfo ───────────────────────────────────────────────────────

  describe("environmentInfo", () => {
    it("returns environment details for a pipeline", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue({
        id: "pipeline-1",
        environment: {
          id: "env-1",
          name: "Development",
          requireDeployApproval: false,
          nodes: [{ id: "agent-1", name: "agent-1", host: "localhost", apiPort: 8686, status: "ONLINE", labels: {} }],
        },
      } as never);

      const result = await caller.environmentInfo({ pipelineId: "pipeline-1" });

      expect(result.environmentId).toBe("env-1");
      expect(result.environmentName).toBe("Development");
      expect(result.nodes).toHaveLength(1);
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null);

      await expect(
        caller.environmentInfo({ pipelineId: "nonexistent" }),
      ).rejects.toThrow("Pipeline not found");
    });
  });

  // ─── approveDeployRequest ─────────────────────────────────────────────────

  describe("approveDeployRequest", () => {
    it("approves a pending deploy request", async () => {
      prismaMock.deployRequest.findUnique.mockResolvedValue({
        id: "req-1",
        status: "PENDING",
        requestedById: "user-2",
      } as never);
      prismaMock.deployRequest.updateMany.mockResolvedValue({ count: 1 } as never);

      const result = await caller.approveDeployRequest({ requestId: "req-1" });

      expect(result.success).toBe(true);
    });

    it("prevents self-approval", async () => {
      prismaMock.deployRequest.findUnique.mockResolvedValue({
        id: "req-1",
        status: "PENDING",
        requestedById: "user-1",
      } as never);

      await expect(
        caller.approveDeployRequest({ requestId: "req-1" }),
      ).rejects.toThrow("Cannot approve your own deploy request");
    });

    it("throws NOT_FOUND when request is not pending", async () => {
      prismaMock.deployRequest.findUnique.mockResolvedValue(null);

      await expect(
        caller.approveDeployRequest({ requestId: "nonexistent" }),
      ).rejects.toThrow("not found or not pending");
    });
  });

  // ─── rejectDeployRequest ──────────────────────────────────────────────────

  describe("rejectDeployRequest", () => {
    it("rejects a pending deploy request", async () => {
      prismaMock.deployRequest.findUnique.mockResolvedValue({
        id: "req-1",
        status: "PENDING",
        environmentId: "env-1",
        pipelineId: "pipeline-1",
      } as never);
      prismaMock.deployRequest.updateMany.mockResolvedValue({ count: 1 } as never);

      const result = await caller.rejectDeployRequest({
        requestId: "req-1",
        note: "Not ready for production",
      });

      expect(result.rejected).toBe(true);
      expect(eventAlerts.fireEventAlert).toHaveBeenCalledWith(
        "deploy_rejected",
        "env-1",
        expect.any(Object),
      );
    });

    it("throws NOT_FOUND when request is not pending", async () => {
      prismaMock.deployRequest.findUnique.mockResolvedValue(null);

      await expect(
        caller.rejectDeployRequest({ requestId: "nonexistent" }),
      ).rejects.toThrow("not found or not pending");
    });
  });

  // ─── cancelDeployRequest ──────────────────────────────────────────────────

  describe("cancelDeployRequest", () => {
    it("requester can cancel their own pending request", async () => {
      prismaMock.deployRequest.findUnique
        .mockResolvedValueOnce({ status: "PENDING", requestedById: "user-1" } as never)
        .mockResolvedValueOnce({ environmentId: "env-1", pipelineId: "pipeline-1" } as never);
      prismaMock.deployRequest.updateMany.mockResolvedValue({ count: 1 } as never);

      const result = await caller.cancelDeployRequest({ requestId: "req-1" });

      expect(result.cancelled).toBe(true);
    });

    it("throws FORBIDDEN when non-requester tries to cancel a pending request", async () => {
      prismaMock.deployRequest.findUnique.mockResolvedValue({
        status: "PENDING",
        requestedById: "user-2",
      } as never);

      await expect(
        caller.cancelDeployRequest({ requestId: "req-1" }),
      ).rejects.toThrow("Only the requester can cancel a pending request");
    });

    it("throws BAD_REQUEST when request is not in a cancellable state", async () => {
      prismaMock.deployRequest.findUnique.mockResolvedValue({
        status: "DEPLOYED",
        requestedById: "user-1",
      } as never);

      await expect(
        caller.cancelDeployRequest({ requestId: "req-1" }),
      ).rejects.toThrow("not pending or approved");
    });
  });
});
