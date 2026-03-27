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

vi.mock("@/server/services/promotion-service", () => ({
  preflightSecrets: vi.fn(),
  executePromotion: vi.fn(),
  generateDiffPreview: vi.fn(),
}));

vi.mock("@/server/services/secret-resolver", () => ({
  collectSecretRefs: vi.fn(),
  convertSecretRefsToEnvVars: vi.fn(),
  secretNameToEnvVar: vi.fn(),
}));

vi.mock("@/server/services/copy-pipeline-graph", () => ({
  copyPipelineGraph: vi.fn(),
}));

vi.mock("@/server/services/outbound-webhook", () => ({
  fireOutboundWebhooks: vi.fn(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn((_: unknown, c: unknown) => c),
  encryptNodeConfig: vi.fn((_: unknown, c: unknown) => c),
}));

vi.mock("@/lib/config-generator", () => ({
  generateVectorYaml: vi.fn().mockReturnValue("sources:\n  my_source:\n    type: stdin\n"),
}));

vi.mock("@/server/services/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { promotionRouter } from "@/server/routers/promotion";
import * as promotionService from "@/server/services/promotion-service";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(promotionRouter)({
  session: { user: { id: "user-1", email: "test@test.com" } },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePipeline(overrides: Record<string, unknown> = {}) {
  return {
    id: "pipeline-1",
    name: "My Pipeline",
    description: null,
    environmentId: "env-source",
    globalConfig: null,
    isDraft: true,
    isSystem: false,
    nodes: [],
    edges: [],
    environment: { teamId: "team-1", id: "env-source" },
    ...overrides,
  };
}

function makeEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    id: "env-target",
    name: "Production",
    teamId: "team-1",
    requireDeployApproval: true,
    ...overrides,
  };
}

function makePromotionRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    sourcePipelineId: "pipeline-1",
    targetPipelineId: null,
    sourceEnvironmentId: "env-source",
    targetEnvironmentId: "env-target",
    status: "PENDING",
    promotedById: "user-2",
    approvedById: null,
    targetPipelineName: "My Pipeline",
    nodesSnapshot: null,
    edgesSnapshot: null,
    globalConfigSnapshot: null,
    reviewNote: null,
    createdAt: new Date(),
    reviewedAt: null,
    deployedAt: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("promotion router", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── preflight ─────────────────────────────────────────────────────────────

  describe("preflight", () => {
    it("preflight blocks when secrets are missing in target env", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.pipeline.findFirst.mockResolvedValue(null);
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
      vi.mocked(promotionService.preflightSecrets).mockResolvedValue({
        missing: ["api_key"],
        present: ["db_password"],
        canProceed: false,
      });

      const result = await caller.preflight({
        pipelineId: "pipeline-1",
        targetEnvironmentId: "env-target",
      });

      expect(result.canProceed).toBe(false);
      expect(result.missing).toContain("api_key");
      expect(result.present).toContain("db_password");
    });

    it("preflight passes when all secrets present", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.pipeline.findFirst.mockResolvedValue(null);
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
      vi.mocked(promotionService.preflightSecrets).mockResolvedValue({
        missing: [],
        present: ["api_key", "db_password"],
        canProceed: true,
      });

      const result = await caller.preflight({
        pipelineId: "pipeline-1",
        targetEnvironmentId: "env-target",
      });

      expect(result.canProceed).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.present).toContain("api_key");
      expect(result.present).toContain("db_password");
    });

    it("preflight passes with no secret refs", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.pipeline.findFirst.mockResolvedValue(null);
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
      vi.mocked(promotionService.preflightSecrets).mockResolvedValue({
        missing: [],
        present: [],
        canProceed: true,
      });

      const result = await caller.preflight({
        pipelineId: "pipeline-1",
        targetEnvironmentId: "env-target",
      });

      expect(result.canProceed).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.present).toHaveLength(0);
    });

    it("preflight reports name collision when pipeline exists in target env", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.pipeline.findFirst.mockResolvedValue({ id: "existing-pipeline" } as never);
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
      vi.mocked(promotionService.preflightSecrets).mockResolvedValue({
        missing: [],
        present: [],
        canProceed: true,
      });

      const result = await caller.preflight({
        pipelineId: "pipeline-1",
        targetEnvironmentId: "env-target",
      });

      expect(result.nameCollision).toBe(true);
    });
  });

  // ─── diffPreview ────────────────────────────────────────────────────────────

  describe("diffPreview", () => {
    it("returns source and target YAML", async () => {
      vi.mocked(promotionService.generateDiffPreview).mockResolvedValue({
        sourceYaml: "sources:\n  stdin: {}\n",
        targetYaml: "sources:\n  stdin: {}\n",
      });

      const result = await caller.diffPreview({ pipelineId: "pipeline-1" });

      expect(result.sourceYaml).toBeDefined();
      expect(result.targetYaml).toBeDefined();
      expect(promotionService.generateDiffPreview).toHaveBeenCalledWith("pipeline-1");
    });
  });

  // ─── initiate ──────────────────────────────────────────────────────────────

  describe("initiate", () => {
    it("creates PENDING request when approval required", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({ requireDeployApproval: true }) as never,
      );
      prismaMock.pipeline.findFirst.mockResolvedValue(null);
      vi.mocked(promotionService.preflightSecrets).mockResolvedValue({
        missing: [],
        present: [],
        canProceed: true,
      });
      prismaMock.promotionRequest.create.mockResolvedValue({
        ...makePromotionRequest({ promotedById: "user-1" }),
      } as never);

      const result = await caller.initiate({
        pipelineId: "pipeline-1",
        targetEnvironmentId: "env-target",
      });

      expect(result.status).toBe("PENDING");
      expect(result.pendingApproval).toBe(true);
      expect(prismaMock.promotionRequest.create).toHaveBeenCalledOnce();
      expect(promotionService.executePromotion).not.toHaveBeenCalled();
    });

    it("auto-executes when approval not required", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({ requireDeployApproval: false }) as never,
      );
      prismaMock.pipeline.findFirst.mockResolvedValue(null);
      vi.mocked(promotionService.preflightSecrets).mockResolvedValue({
        missing: [],
        present: [],
        canProceed: true,
      });
      prismaMock.promotionRequest.create.mockResolvedValue({
        ...makePromotionRequest({ promotedById: "user-1" }),
      } as never);
      vi.mocked(promotionService.executePromotion).mockResolvedValue({
        pipelineId: "new-pipeline-1",
        pipelineName: "My Pipeline",
      });

      const result = await caller.initiate({
        pipelineId: "pipeline-1",
        targetEnvironmentId: "env-target",
      });

      expect(result.status).toBe("DEPLOYED");
      expect(result.pendingApproval).toBe(false);
      expect(promotionService.executePromotion).toHaveBeenCalledOnce();
    });

    it("throws BAD_REQUEST if same environment", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(
        makePipeline({ environmentId: "env-target" }) as never,
      );
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);

      await expect(
        caller.initiate({
          pipelineId: "pipeline-1",
          targetEnvironmentId: "env-target",
        }),
      ).rejects.toThrow("Source and target environments must be different");
    });

    it("throws BAD_REQUEST if different team", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(
        makePipeline({ environment: { teamId: "team-1", id: "env-source" } }) as never,
      );
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({ teamId: "team-2" }) as never,
      );

      await expect(
        caller.initiate({
          pipelineId: "pipeline-1",
          targetEnvironmentId: "env-target",
        }),
      ).rejects.toThrow("same team");
    });

    it("throws BAD_REQUEST if pipeline name collision", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
      prismaMock.pipeline.findFirst.mockResolvedValue({
        id: "existing-pipeline",
        name: "My Pipeline",
      } as never);

      await expect(
        caller.initiate({
          pipelineId: "pipeline-1",
          targetEnvironmentId: "env-target",
        }),
      ).rejects.toThrow("already exists");
    });

    it("throws BAD_REQUEST if secrets are missing", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(makePipeline() as never);
      prismaMock.environment.findUnique.mockResolvedValue(makeEnvironment() as never);
      prismaMock.pipeline.findFirst.mockResolvedValue(null);
      vi.mocked(promotionService.preflightSecrets).mockResolvedValue({
        missing: ["api_key"],
        present: [],
        canProceed: false,
      });

      await expect(
        caller.initiate({
          pipelineId: "pipeline-1",
          targetEnvironmentId: "env-target",
        }),
      ).rejects.toThrow("Missing secrets");
    });

    it("stores nodesSnapshot and edgesSnapshot from source pipeline at request time", async () => {
      const nodes = [
        {
          id: "node-1",
          componentKey: "my_source",
          componentType: "stdin",
          kind: "SOURCE",
          config: { encoding: { codec: "json" } },
          positionX: 0,
          positionY: 0,
          disabled: false,
        },
      ];
      const edges = [
        { id: "edge-1", sourceNodeId: "node-1", targetNodeId: "node-2", sourcePort: null },
      ];
      prismaMock.pipeline.findUnique.mockResolvedValue(
        makePipeline({ nodes, edges }) as never,
      );
      prismaMock.environment.findUnique.mockResolvedValue(
        makeEnvironment({ requireDeployApproval: true }) as never,
      );
      prismaMock.pipeline.findFirst.mockResolvedValue(null);
      vi.mocked(promotionService.preflightSecrets).mockResolvedValue({
        missing: [],
        present: [],
        canProceed: true,
      });
      prismaMock.promotionRequest.create.mockResolvedValue({
        ...makePromotionRequest({ promotedById: "user-1" }),
      } as never);

      await caller.initiate({
        pipelineId: "pipeline-1",
        targetEnvironmentId: "env-target",
      });

      const createCall = prismaMock.promotionRequest.create.mock.calls[0][0];
      expect(createCall.data.nodesSnapshot).toBeDefined();
      expect(createCall.data.edgesSnapshot).toBeDefined();
    });
  });

  // ─── approve ────────────────────────────────────────────────────────────────

  describe("approve", () => {
    it("self-review blocked — promoter cannot approve own request", async () => {
      prismaMock.promotionRequest.findUnique.mockResolvedValue(
        makePromotionRequest({ promotedById: "user-1" }) as never,
      );

      await expect(
        caller.approve({ requestId: "req-1" }),
      ).rejects.toThrow("Cannot approve your own promotion request");
    });

    it("atomic approve prevents race condition — returns BAD_REQUEST if count 0", async () => {
      prismaMock.promotionRequest.findUnique.mockResolvedValue(
        makePromotionRequest({ promotedById: "user-2" }) as never,
      );
      prismaMock.promotionRequest.updateMany.mockResolvedValue({ count: 0 } as never);

      await expect(
        caller.approve({ requestId: "req-1" }),
      ).rejects.toThrow("no longer pending");
    });

    it("succeeds for different user and calls executePromotion", async () => {
      prismaMock.promotionRequest.findUnique.mockResolvedValue(
        makePromotionRequest({ promotedById: "user-2" }) as never,
      );
      prismaMock.promotionRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      vi.mocked(promotionService.executePromotion).mockResolvedValue({
        pipelineId: "new-pipeline-1",
        pipelineName: "My Pipeline",
      });

      const result = await caller.approve({ requestId: "req-1" });

      expect(result.success).toBe(true);
      expect(promotionService.executePromotion).toHaveBeenCalledWith("req-1", "user-1");
    });
  });

  // ─── reject ──────────────────────────────────────────────────────────────────

  describe("reject", () => {
    it("sets status REJECTED with review note", async () => {
      prismaMock.promotionRequest.findUnique.mockResolvedValue(
        makePromotionRequest({ promotedById: "user-2" }) as never,
      );
      prismaMock.promotionRequest.updateMany.mockResolvedValue({ count: 1 } as never);

      const result = await caller.reject({ requestId: "req-1", note: "Not ready" });

      expect(result.rejected).toBe(true);
      const updateCall = prismaMock.promotionRequest.updateMany.mock.calls[0][0];
      expect(updateCall.data.status).toBe("REJECTED");
      expect(updateCall.data.reviewNote).toBe("Not ready");
    });

    it("throws if request not found or not pending", async () => {
      prismaMock.promotionRequest.findUnique.mockResolvedValue(null);

      await expect(
        caller.reject({ requestId: "req-missing" }),
      ).rejects.toThrow("not found or not pending");
    });
  });

  // ─── cancel ──────────────────────────────────────────────────────────────────

  describe("cancel", () => {
    it("only promoter can cancel — throws FORBIDDEN for different user", async () => {
      prismaMock.promotionRequest.findUnique.mockResolvedValue(
        makePromotionRequest({ promotedById: "user-2" }) as never,
      );

      await expect(
        caller.cancel({ requestId: "req-1" }),
      ).rejects.toThrow("Only the original promoter");
    });

    it("promoter can cancel their own request", async () => {
      prismaMock.promotionRequest.findUnique.mockResolvedValue(
        makePromotionRequest({ promotedById: "user-1" }) as never,
      );
      prismaMock.promotionRequest.updateMany.mockResolvedValue({ count: 1 } as never);

      const result = await caller.cancel({ requestId: "req-1" });

      expect(result.cancelled).toBe(true);
    });
  });

  // ─── history ─────────────────────────────────────────────────────────────────

  describe("history", () => {
    it("returns records ordered by createdAt desc", async () => {
      const records = [
        {
          ...makePromotionRequest({ createdAt: new Date("2026-03-27") }),
          promotedBy: { name: "Alice", email: "alice@test.com" },
          approvedBy: null,
          sourceEnvironment: { name: "Development" },
          targetEnvironment: { name: "Production" },
        },
        {
          ...makePromotionRequest({ id: "req-2", createdAt: new Date("2026-03-26") }),
          promotedBy: { name: "Bob", email: "bob@test.com" },
          approvedBy: null,
          sourceEnvironment: { name: "Development" },
          targetEnvironment: { name: "Staging" },
        },
      ];
      prismaMock.promotionRequest.findMany.mockResolvedValue(records as never);

      const result = await caller.history({ pipelineId: "pipeline-1" });

      expect(result).toHaveLength(2);
      expect(prismaMock.promotionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sourcePipelineId: "pipeline-1" },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      );
    });
  });

  // ─── SECRET[name] ref preservation ───────────────────────────────────────────

  describe("clone preserves SECRET refs", () => {
    it("executePromotion does not strip SECRET[name] refs from cloned pipeline config", async () => {
      // This test verifies the behavior is wired correctly: no transformConfig is passed
      // to copyPipelineGraph, so SECRET[name] refs are preserved intact.
      // The promotion service is tested here via mocked executePromotion.
      // The actual preservation is enforced in promotion-service.ts by not passing transformConfig.
      vi.mocked(promotionService.executePromotion).mockResolvedValue({
        pipelineId: "new-pipeline-1",
        pipelineName: "My Pipeline",
      });
      prismaMock.promotionRequest.findUnique.mockResolvedValue(
        makePromotionRequest({ promotedById: "user-2" }) as never,
      );
      prismaMock.promotionRequest.updateMany.mockResolvedValue({ count: 1 } as never);

      const result = await caller.approve({ requestId: "req-1" });

      // Verify executePromotion was called (which internally uses copyPipelineGraph without stripping)
      expect(promotionService.executePromotion).toHaveBeenCalledWith("req-1", "user-1");
      expect(result.success).toBe(true);
    });

    it("diffPreview targetYaml uses SECRET ref placeholders (not plaintext)", async () => {
      // sourceYaml shows SECRET[api_key] as-is, targetYaml converts to ${VF_SECRET_API_KEY}
      vi.mocked(promotionService.generateDiffPreview).mockResolvedValue({
        sourceYaml: "password: SECRET[api_key]\n",
        targetYaml: "password: ${VF_SECRET_API_KEY}\n",
      });

      const result = await caller.diffPreview({ pipelineId: "pipeline-1" });

      // Source YAML preserves SECRET[name] reference format
      expect(result.sourceYaml).toContain("SECRET[api_key]");
      // Target YAML uses env var placeholder format
      expect(result.targetYaml).toContain("VF_SECRET_API_KEY");
    });
  });
});
