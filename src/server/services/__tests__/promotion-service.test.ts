import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/config-crypto", () => ({
  decryptNodeConfig: vi.fn((_: unknown, config: unknown) => config),
}));

vi.mock("@/server/services/secret-resolver", () => ({
  collectSecretRefs: vi.fn(),
  convertSecretRefsToEnvVars: vi.fn((config: unknown) => config),
}));

vi.mock("@/server/services/copy-pipeline-graph", () => ({
  copyPipelineGraph: vi.fn(),
}));

vi.mock("@/server/services/outbound-webhook", () => ({
  fireOutboundWebhooks: vi.fn(),
}));

vi.mock("@/lib/config-generator", () => ({
  generateVectorYaml: vi.fn().mockReturnValue("sources:\n  stdin: {}\n"),
}));

// ─── Import SUT + mocks ─────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { preflightSecrets, executePromotion, generateDiffPreview } from "@/server/services/promotion-service";
import * as secretResolver from "@/server/services/secret-resolver";
import * as copyGraph from "@/server/services/copy-pipeline-graph";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("promotion-service", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ─── preflightSecrets ──────────────────────────────────────────────────────

  describe("preflightSecrets", () => {
    it("returns canProceed true when no secrets are referenced", async () => {
      prismaMock.pipelineNode.findMany.mockResolvedValue([
        { componentType: "stdin", config: {} },
      ] as never);
      vi.mocked(secretResolver.collectSecretRefs).mockReturnValue([]);

      const result = await preflightSecrets("pipeline-1", "env-target");

      expect(result.canProceed).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.present).toHaveLength(0);
    });

    it("reports missing secrets when target env lacks them", async () => {
      prismaMock.pipelineNode.findMany.mockResolvedValue([
        { componentType: "http", config: { password: "SECRET[api_key]" } },
      ] as never);
      vi.mocked(secretResolver.collectSecretRefs).mockReturnValue(["api_key"]);
      prismaMock.secret.findMany.mockResolvedValue([] as never);

      const result = await preflightSecrets("pipeline-1", "env-target");

      expect(result.canProceed).toBe(false);
      expect(result.missing).toContain("api_key");
    });

    it("returns canProceed true when all secrets exist in target", async () => {
      prismaMock.pipelineNode.findMany.mockResolvedValue([
        { componentType: "http", config: { password: "SECRET[api_key]" } },
      ] as never);
      vi.mocked(secretResolver.collectSecretRefs).mockReturnValue(["api_key"]);
      prismaMock.secret.findMany.mockResolvedValue([
        { name: "api_key" },
      ] as never);

      const result = await preflightSecrets("pipeline-1", "env-target");

      expect(result.canProceed).toBe(true);
      expect(result.present).toContain("api_key");
      expect(result.missing).toHaveLength(0);
    });

    it("aggregates secret refs across multiple nodes", async () => {
      prismaMock.pipelineNode.findMany.mockResolvedValue([
        { componentType: "http", config: { password: "SECRET[db_pass]" } },
        { componentType: "splunk", config: { token: "SECRET[splunk_token]" } },
      ] as never);
      vi.mocked(secretResolver.collectSecretRefs)
        .mockReturnValueOnce(["db_pass"])
        .mockReturnValueOnce(["splunk_token"]);
      prismaMock.secret.findMany.mockResolvedValue([
        { name: "db_pass" },
      ] as never);

      const result = await preflightSecrets("pipeline-1", "env-target");

      expect(result.canProceed).toBe(false);
      expect(result.present).toContain("db_pass");
      expect(result.missing).toContain("splunk_token");
    });
  });

  // ─── executePromotion ──────────────────────────────────────────────────────

  describe("executePromotion", () => {
    it("creates target pipeline and copies graph in a transaction", async () => {
      const request = {
        id: "req-1",
        sourcePipelineId: "p-source",
        targetEnvironmentId: "env-target",
        targetPipelineName: "My Pipeline",
        globalConfigSnapshot: null,
        promotedById: "user-1",
        sourceEnvironmentId: "env-source",
        sourcePipeline: {
          name: "My Pipeline",
          description: "test",
          environmentId: "env-source",
          environment: { teamId: "team-1" },
        },
        targetEnvironment: { name: "Production", teamId: "team-1" },
      };

      prismaMock.promotionRequest.findUnique.mockResolvedValue(request as never);
      prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          pipeline: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: "p-target", name: "My Pipeline" }),
          },
          promotionRequest: {
            update: vi.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      const result = await executePromotion("req-1", "user-2");

      expect(result.pipelineId).toBe("p-target");
      expect(result.pipelineName).toBe("My Pipeline");
      expect(copyGraph.copyPipelineGraph).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sourcePipelineId: "p-source",
          targetPipelineId: "p-target",
          stripSharedComponentLinks: true,
        }),
      );
    });

    it("throws NOT_FOUND when promotion request does not exist", async () => {
      prismaMock.promotionRequest.findUnique.mockResolvedValue(null);

      await expect(
        executePromotion("nonexistent", "user-1"),
      ).rejects.toThrow("Promotion request not found");
    });
  });

  // ─── generateDiffPreview ───────────────────────────────────────────────────

  describe("generateDiffPreview", () => {
    it("returns source and target YAML", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue({
        id: "pipeline-1",
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
        globalConfig: null,
        environment: { name: "Development" },
      } as never);

      const result = await generateDiffPreview("pipeline-1");

      expect(result.sourceYaml).toBeDefined();
      expect(result.targetYaml).toBeDefined();
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null);

      await expect(
        generateDiffPreview("nonexistent"),
      ).rejects.toThrow("Pipeline not found");
    });
  });
});
