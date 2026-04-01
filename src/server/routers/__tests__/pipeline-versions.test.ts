import { vi, describe, it, expect, beforeEach } from "vitest";
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

vi.mock("@/server/services/pipeline-version", () => ({
  createVersion: vi.fn(),
  listVersions: vi.fn(),
  listVersionsSummary: vi.fn(),
  getVersion: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock("@/server/services/push-broadcast", () => ({
  relayPush: vi.fn(),
}));

vi.mock("@/server/services/sse-broadcast", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("@/server/services/event-alerts", () => ({
  fireEventAlert: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { pipelineVersionsRouter } from "@/server/routers/pipeline-versions";
import {
  createVersion,
  listVersions,
  listVersionsSummary,
  getVersion,
  rollback,
} from "@/server/services/pipeline-version";
import { relayPush } from "@/server/services/push-broadcast";
import { broadcastSSE } from "@/server/services/sse-broadcast";
import { fireEventAlert } from "@/server/services/event-alerts";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(pipelineVersionsRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

const callerNoUser = t.createCallerFactory(pipelineVersionsRouter)({
  session: { user: { id: undefined } },
  userRole: "ADMIN",
  teamId: "team-1",
});

describe("pipelineVersionsRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  // ── versions ──────────────────────────────────────────────────────────────

  describe("versions", () => {
    it("delegates to listVersions service", async () => {
      const versions = [
        { id: "v-1", version: 1, configYaml: "yaml-1" },
        { id: "v-2", version: 2, configYaml: "yaml-2" },
      ];
      vi.mocked(listVersions).mockResolvedValue(versions as never);

      const result = await caller.versions({ pipelineId: "p-1" });

      expect(result).toEqual(versions);
      expect(listVersions).toHaveBeenCalledWith("p-1");
    });
  });

  // ── versionsSummary ───────────────────────────────────────────────────────

  describe("versionsSummary", () => {
    it("delegates to listVersionsSummary service", async () => {
      const summary = [
        { id: "v-1", version: 1, changelog: "Initial" },
        { id: "v-2", version: 2, changelog: "Updated" },
      ];
      vi.mocked(listVersionsSummary).mockResolvedValue(summary as never);

      const result = await caller.versionsSummary({ pipelineId: "p-1" });

      expect(result).toEqual(summary);
      expect(listVersionsSummary).toHaveBeenCalledWith("p-1");
    });
  });

  // ── createVersion ─────────────────────────────────────────────────────────

  describe("createVersion", () => {
    it("creates a version with node and edge snapshots", async () => {
      const pipeline = {
        globalConfig: { log_level: "info" },
        nodes: [
          {
            id: "node-1",
            componentKey: "my_source",
            displayName: null,
            componentType: "stdin",
            kind: "SOURCE",
            config: { key: "value" },
            positionX: 100,
            positionY: 200,
            disabled: false,
            sharedComponentId: null,
            sharedComponentVersion: null,
          },
        ],
        edges: [
          {
            id: "edge-1",
            sourceNodeId: "node-1",
            targetNodeId: "node-2",
            sourcePort: null,
          },
        ],
      };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);

      const version = { id: "v-1", version: 1, configYaml: "sources:\n  stdin:\n    type: stdin\n" };
      vi.mocked(createVersion).mockResolvedValue(version as never);

      const result = await caller.createVersion({
        pipelineId: "p-1",
        configYaml: "sources:\n  stdin:\n    type: stdin\n",
        changelog: "Initial version",
      });

      expect(result).toEqual(version);
      expect(createVersion).toHaveBeenCalledWith(
        "p-1",
        "sources:\n  stdin:\n    type: stdin\n",
        "user-1",
        "Initial version",
        "info",
        { log_level: "info" },
        [
          expect.objectContaining({
            id: "node-1",
            componentKey: "my_source",
            componentType: "stdin",
            kind: "SOURCE",
          }),
        ],
        [
          expect.objectContaining({
            id: "edge-1",
            sourceNodeId: "node-1",
            targetNodeId: "node-2",
          }),
        ],
      );
    });

    it("throws NOT_FOUND when pipeline does not exist", async () => {
      prismaMock.pipeline.findUnique.mockResolvedValue(null as never);

      await expect(
        caller.createVersion({ pipelineId: "missing", configYaml: "yaml" }),
      ).rejects.toThrow("Pipeline not found");
    });

    it("throws UNAUTHORIZED when user id is not present", async () => {
      await expect(
        callerNoUser.createVersion({ pipelineId: "p-1", configYaml: "yaml" }),
      ).rejects.toThrow();
    });
  });

  // ── getVersion ────────────────────────────────────────────────────────────

  describe("getVersion", () => {
    it("delegates to getVersion service", async () => {
      const version = {
        id: "v-1",
        version: 1,
        configYaml: "yaml",
        nodesSnapshot: [],
        edgesSnapshot: [],
      };
      vi.mocked(getVersion).mockResolvedValue(version as never);

      const result = await caller.getVersion({ versionId: "v-1" });

      expect(result).toEqual(version);
      expect(getVersion).toHaveBeenCalledWith("v-1");
    });
  });

  // ── rollback ──────────────────────────────────────────────────────────────

  describe("rollback", () => {
    it("performs rollback and notifies agents and browsers", async () => {
      const version = { id: "v-1", version: 1, configYaml: "yaml" };
      vi.mocked(rollback).mockResolvedValue(version as never);

      const pipeline = {
        name: "Test Pipeline",
        environmentId: "env-1",
        nodeSelector: null,
      };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
      prismaMock.vectorNode.findMany.mockResolvedValue([
        { id: "node-1", labels: {} },
        { id: "node-2", labels: {} },
      ] as never);

      const result = await caller.rollback({
        pipelineId: "p-1",
        targetVersionId: "v-1",
      });

      expect(result).toEqual(version);
      expect(rollback).toHaveBeenCalledWith("p-1", "v-1", "user-1");

      // Verify relayPush was called for each matching node
      expect(relayPush).toHaveBeenCalledTimes(2);
      expect(relayPush).toHaveBeenCalledWith(
        "node-1",
        expect.objectContaining({ type: "config_changed", reason: "rollback" }),
      );

      // Verify broadcastSSE was called
      expect(broadcastSSE).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "status_change",
          toStatus: "DEPLOYED",
          reason: "rollback",
          pipelineId: "p-1",
          pipelineName: "Test Pipeline",
        }),
        "env-1",
      );

      // Verify fireEventAlert was called
      expect(fireEventAlert).toHaveBeenCalledWith(
        "deploy_completed",
        "env-1",
        expect.objectContaining({
          message: 'Pipeline "Test Pipeline" rolled back',
          pipelineId: "p-1",
        }),
      );
    });

    it("throws UNAUTHORIZED when user id is not present", async () => {
      await expect(
        callerNoUser.rollback({ pipelineId: "p-1", targetVersionId: "v-1" }),
      ).rejects.toThrow();
    });

    it("filters target nodes by nodeSelector labels", async () => {
      const version = { id: "v-1", version: 1, configYaml: "yaml" };
      vi.mocked(rollback).mockResolvedValue(version as never);

      const pipeline = {
        name: "Test Pipeline",
        environmentId: "env-1",
        nodeSelector: { region: "us-east" },
      };
      prismaMock.pipeline.findUnique.mockResolvedValue(pipeline as never);
      prismaMock.vectorNode.findMany.mockResolvedValue([
        { id: "node-1", labels: { region: "us-east" } },
        { id: "node-2", labels: { region: "eu-west" } },
        { id: "node-3", labels: { region: "us-east", role: "worker" } },
      ] as never);

      await caller.rollback({ pipelineId: "p-1", targetVersionId: "v-1" });

      // Only node-1 and node-3 match the nodeSelector
      expect(relayPush).toHaveBeenCalledTimes(2);
      expect(relayPush).toHaveBeenCalledWith("node-1", expect.anything());
      expect(relayPush).toHaveBeenCalledWith("node-3", expect.anything());
    });

    it("continues even if side-effect notifications fail", async () => {
      const version = { id: "v-1", version: 1, configYaml: "yaml" };
      vi.mocked(rollback).mockResolvedValue(version as never);

      // Pipeline lookup throws during side-effect phase
      prismaMock.pipeline.findUnique.mockRejectedValue(new Error("DB down"));

      const result = await caller.rollback({
        pipelineId: "p-1",
        targetVersionId: "v-1",
      });

      // Rollback still succeeds even though the notification phase failed
      expect(result).toEqual(version);
    });
  });
});
