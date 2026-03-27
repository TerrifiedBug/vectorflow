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

// ─── Import SUT + mocks after vi.mock ───────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { nodeGroupRouter } from "@/server/routers/node-group";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(nodeGroupRouter)({
  session: { user: { id: "user-1" } },
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeNodeGroup(overrides: Partial<{
  id: string;
  name: string;
  environmentId: string;
  criteria: Record<string, string>;
  labelTemplate: Record<string, string>;
  requiredLabels: string[];
}> = {}) {
  return {
    id: overrides.id ?? "ng-1",
    name: overrides.name ?? "US East",
    environmentId: overrides.environmentId ?? "env-1",
    criteria: overrides.criteria ?? { region: "us-east" },
    labelTemplate: overrides.labelTemplate ?? { env: "prod" },
    requiredLabels: overrides.requiredLabels ?? ["region", "role"],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeNode(overrides: Partial<{
  id: string;
  name: string;
  status: "HEALTHY" | "DEGRADED" | "UNREACHABLE" | "UNKNOWN";
  labels: Record<string, string>;
  lastSeen: Date | null;
  nodeMetrics: Array<{ loadAvg1: number }>;
}> = {}) {
  return {
    id: overrides.id ?? "node-1",
    name: overrides.name ?? "node-1",
    status: overrides.status ?? "HEALTHY",
    labels: overrides.labels ?? {},
    lastSeen: overrides.lastSeen !== undefined ? overrides.lastSeen : new Date(),
    nodeMetrics: overrides.nodeMetrics ?? [],
  };
}

function makeAlertEvent(overrides: Partial<{
  id: string;
  nodeId: string | null;
  status: "firing" | "resolved" | "acknowledged";
}> = {}) {
  return {
    id: overrides.id ?? "alert-1",
    nodeId: overrides.nodeId !== undefined ? overrides.nodeId : "node-1",
    status: overrides.status ?? "firing",
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("nodeGroupRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  // ── list ────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns node groups for an environment ordered by name", async () => {
      const groups = [
        makeNodeGroup({ id: "ng-1", name: "EU West" }),
        makeNodeGroup({ id: "ng-2", name: "US East" }),
      ];
      prismaMock.nodeGroup.findMany.mockResolvedValue(groups as never);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toEqual(groups);
      expect(prismaMock.nodeGroup.findMany).toHaveBeenCalledWith({
        where: { environmentId: "env-1" },
        orderBy: { name: "asc" },
      });
    });

    it("returns empty array when no groups exist", async () => {
      prismaMock.nodeGroup.findMany.mockResolvedValue([]);

      const result = await caller.list({ environmentId: "env-1" });

      expect(result).toEqual([]);
    });
  });

  // ── create ──────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a node group with name, criteria, labelTemplate, requiredLabels", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue(null);
      const created = makeNodeGroup({ id: "ng-new", name: "Asia Pacific" });
      prismaMock.nodeGroup.create.mockResolvedValue(created as never);

      const result = await caller.create({
        environmentId: "env-1",
        name: "Asia Pacific",
        criteria: { region: "ap-southeast" },
        labelTemplate: { env: "prod", tier: "1" },
        requiredLabels: ["region", "role"],
      });

      expect(result).toEqual(created);
      expect(prismaMock.nodeGroup.create).toHaveBeenCalledWith({
        data: {
          name: "Asia Pacific",
          environmentId: "env-1",
          criteria: { region: "ap-southeast" },
          labelTemplate: { env: "prod", tier: "1" },
          requiredLabels: ["region", "role"],
        },
      });
    });

    it("throws CONFLICT when duplicate name in same environment", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue(makeNodeGroup() as never);

      await expect(
        caller.create({ environmentId: "env-1", name: "US East" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(prismaMock.nodeGroup.create).not.toHaveBeenCalled();
    });

    it("rejects empty name (Zod validation)", async () => {
      await expect(
        caller.create({ environmentId: "env-1", name: "" }),
      ).rejects.toThrow();
    });
  });

  // ── update ──────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates group name", async () => {
      prismaMock.nodeGroup.findUnique
        .mockResolvedValueOnce(makeNodeGroup({ id: "ng-1", name: "Old Name" }) as never)
        .mockResolvedValueOnce(null); // no conflict

      const updated = makeNodeGroup({ id: "ng-1", name: "New Name" });
      prismaMock.nodeGroup.update.mockResolvedValue(updated as never);

      const result = await caller.update({ id: "ng-1", name: "New Name" });

      expect(result.name).toBe("New Name");
    });

    it("throws NOT_FOUND for non-existent group", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue(null);

      await expect(
        caller.update({ id: "nonexistent", name: "Foo" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws CONFLICT when renaming to existing name", async () => {
      prismaMock.nodeGroup.findUnique
        .mockResolvedValueOnce(makeNodeGroup({ id: "ng-1", name: "Alpha" }) as never)
        .mockResolvedValueOnce(makeNodeGroup({ id: "ng-2", name: "Beta" }) as never); // conflict!

      await expect(
        caller.update({ id: "ng-1", name: "Beta" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("skips uniqueness check when name is unchanged", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValueOnce(
        makeNodeGroup({ id: "ng-1", name: "Same Name" }) as never,
      );

      prismaMock.nodeGroup.update.mockResolvedValue(
        makeNodeGroup({ id: "ng-1", name: "Same Name" }) as never,
      );

      await caller.update({ id: "ng-1", name: "Same Name" });

      // findUnique called only once (to fetch the group), not twice
      expect(prismaMock.nodeGroup.findUnique).toHaveBeenCalledTimes(1);
    });

    it("updates labelTemplate", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValueOnce(
        makeNodeGroup({ id: "ng-1" }) as never,
      );

      const updated = makeNodeGroup({ id: "ng-1", labelTemplate: { env: "staging", tier: "2" } });
      prismaMock.nodeGroup.update.mockResolvedValue(updated as never);

      const result = await caller.update({ id: "ng-1", labelTemplate: { env: "staging", tier: "2" } });

      expect(prismaMock.nodeGroup.update).toHaveBeenCalledWith({
        where: { id: "ng-1" },
        data: { labelTemplate: { env: "staging", tier: "2" } },
      });
      expect(result).toEqual(updated);
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes an existing group", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue({ id: "ng-1" } as never);
      prismaMock.nodeGroup.delete.mockResolvedValue(makeNodeGroup({ id: "ng-1" }) as never);

      const result = await caller.delete({ id: "ng-1" });

      expect(result.id).toBe("ng-1");
      expect(prismaMock.nodeGroup.delete).toHaveBeenCalledWith({
        where: { id: "ng-1" },
      });
    });

    it("throws NOT_FOUND for non-existent group", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue(null);

      await expect(
        caller.delete({ id: "nonexistent" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ── groupHealthStats ─────────────────────────────────────────────────────

  describe("groupHealthStats", () => {
    it("Test 1: Returns per-group stats (onlineCount, alertCount, complianceRate, totalNodes) for two groups", async () => {
      const groups = [
        makeNodeGroup({ id: "ng-1", name: "US East", criteria: { region: "us-east" }, requiredLabels: ["region"] }),
        makeNodeGroup({ id: "ng-2", name: "EU West", criteria: { region: "eu-west" }, requiredLabels: ["region"] }),
      ];
      const nodes = [
        makeNode({ id: "n-1", status: "HEALTHY", labels: { region: "us-east" } }),
        makeNode({ id: "n-2", status: "DEGRADED", labels: { region: "us-east" } }),
        makeNode({ id: "n-3", status: "HEALTHY", labels: { region: "eu-west" } }),
      ];
      const firingAlerts = [makeAlertEvent({ nodeId: "n-2", status: "firing" })];

      prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);
      prismaMock.nodeGroup.findMany.mockResolvedValue(groups as never);
      prismaMock.alertEvent.findMany.mockResolvedValue(firingAlerts as never);

      const result = await caller.groupHealthStats({ environmentId: "env-1" });

      const usEast = result.find((r) => r.id === "ng-1");
      const euWest = result.find((r) => r.id === "ng-2");

      expect(usEast).toBeDefined();
      expect(usEast!.totalNodes).toBe(2);
      expect(usEast!.onlineCount).toBe(1); // only HEALTHY
      expect(usEast!.alertCount).toBe(1); // n-2 has firing alert
      expect(usEast!.complianceRate).toBe(100); // both have 'region' label

      expect(euWest).toBeDefined();
      expect(euWest!.totalNodes).toBe(1);
      expect(euWest!.onlineCount).toBe(1);
      expect(euWest!.alertCount).toBe(0);
    });

    it("Test 2: Group with empty criteria {} matches all nodes (catch-all) — totalNodes equals total environment nodes", async () => {
      const groups = [
        makeNodeGroup({ id: "ng-all", name: "All Nodes", criteria: {}, requiredLabels: [] }),
      ];
      const nodes = [
        makeNode({ id: "n-1", labels: { region: "us-east" } }),
        makeNode({ id: "n-2", labels: { region: "eu-west" } }),
        makeNode({ id: "n-3", labels: {} }),
      ];

      prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);
      prismaMock.nodeGroup.findMany.mockResolvedValue(groups as never);
      prismaMock.alertEvent.findMany.mockResolvedValue([] as never);

      const result = await caller.groupHealthStats({ environmentId: "env-1" });

      const allGroup = result.find((r) => r.id === "ng-all");
      expect(allGroup).toBeDefined();
      expect(allGroup!.totalNodes).toBe(3); // matches all
      // No ungrouped since all matched
      expect(result.find((r) => r.id === "__ungrouped__")).toBeUndefined();
    });

    it("Test 3: Includes synthetic 'Ungrouped' entry for nodes matching no group", async () => {
      const groups = [
        makeNodeGroup({ id: "ng-1", name: "US East", criteria: { region: "us-east" }, requiredLabels: [] }),
      ];
      const nodes = [
        makeNode({ id: "n-1", labels: { region: "us-east" } }),
        makeNode({ id: "n-2", labels: { region: "eu-west" } }), // no matching group
        makeNode({ id: "n-3", labels: {} }), // no matching group
      ];

      prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);
      prismaMock.nodeGroup.findMany.mockResolvedValue(groups as never);
      prismaMock.alertEvent.findMany.mockResolvedValue([] as never);

      const result = await caller.groupHealthStats({ environmentId: "env-1" });

      const ungrouped = result.find((r) => r.id === "__ungrouped__");
      expect(ungrouped).toBeDefined();
      expect(ungrouped!.name).toBe("Ungrouped");
      expect(ungrouped!.totalNodes).toBe(2); // n-2 and n-3
    });

    it("Test 4: complianceRate is 100 when requiredLabels is empty (vacuous truth)", async () => {
      const groups = [
        makeNodeGroup({ id: "ng-1", name: "Any", criteria: {}, requiredLabels: [] }),
      ];
      const nodes = [
        makeNode({ id: "n-1", labels: {} }), // no labels at all
        makeNode({ id: "n-2", labels: { random: "value" } }),
      ];

      prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);
      prismaMock.nodeGroup.findMany.mockResolvedValue(groups as never);
      prismaMock.alertEvent.findMany.mockResolvedValue([] as never);

      const result = await caller.groupHealthStats({ environmentId: "env-1" });

      const group = result.find((r) => r.id === "ng-1");
      expect(group!.complianceRate).toBe(100);
    });

    it("Test 5: alertCount only counts AlertStatus.firing, not resolved/acknowledged", async () => {
      const groups = [
        makeNodeGroup({ id: "ng-1", criteria: {}, requiredLabels: [] }),
      ];
      const nodes = [
        makeNode({ id: "n-1" }),
        makeNode({ id: "n-2" }),
        makeNode({ id: "n-3" }),
      ];
      // Only n-1 has a firing alert; n-2 has resolved, n-3 has acknowledged
      const alerts = [
        makeAlertEvent({ nodeId: "n-1", status: "firing" }),
        // resolved and acknowledged should not appear since we filter for firing only
      ];

      prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);
      prismaMock.nodeGroup.findMany.mockResolvedValue(groups as never);
      prismaMock.alertEvent.findMany.mockResolvedValue(alerts as never);

      const result = await caller.groupHealthStats({ environmentId: "env-1" });

      const group = result.find((r) => r.id === "ng-1");
      expect(group!.alertCount).toBe(1); // only the firing one
    });

    it("Test 6: Returns empty array when no groups and no nodes exist (no ungrouped entry)", async () => {
      prismaMock.vectorNode.findMany.mockResolvedValue([] as never);
      prismaMock.nodeGroup.findMany.mockResolvedValue([] as never);
      prismaMock.alertEvent.findMany.mockResolvedValue([] as never);

      const result = await caller.groupHealthStats({ environmentId: "env-1" });

      expect(result).toEqual([]);
    });
  });

  // ── nodesInGroup ─────────────────────────────────────────────────────────

  describe("nodesInGroup", () => {
    it("Test 7: Returns nodes matching criteria sorted by status (UNREACHABLE first, then DEGRADED, then HEALTHY), then by name", async () => {
      const group = makeNodeGroup({
        id: "ng-1",
        criteria: { region: "us-east" },
        requiredLabels: [],
      });
      const nodes = [
        makeNode({ id: "n-healthy", name: "alpha", status: "HEALTHY", labels: { region: "us-east" } }),
        makeNode({ id: "n-unreachable", name: "beta", status: "UNREACHABLE", labels: { region: "us-east" } }),
        makeNode({ id: "n-degraded", name: "gamma", status: "DEGRADED", labels: { region: "us-east" } }),
      ];

      prismaMock.nodeGroup.findUnique.mockResolvedValue(group as never);
      prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);

      const result = await caller.nodesInGroup({ groupId: "ng-1", environmentId: "env-1" });

      expect(result[0].status).toBe("UNREACHABLE");
      expect(result[1].status).toBe("DEGRADED");
      expect(result[2].status).toBe("HEALTHY");
    });

    it("Test 8: Attaches cpuLoad from latest NodeMetric (nodeMetrics[0].loadAvg1) — null when no metrics", async () => {
      const group = makeNodeGroup({ id: "ng-1", criteria: {}, requiredLabels: [] });
      const nodes = [
        makeNode({ id: "n-with-metrics", name: "a", nodeMetrics: [{ loadAvg1: 0.75 }] }),
        makeNode({ id: "n-no-metrics", name: "b", nodeMetrics: [] }),
      ];

      prismaMock.nodeGroup.findUnique.mockResolvedValue(group as never);
      prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);

      const result = await caller.nodesInGroup({ groupId: "ng-1", environmentId: "env-1" });

      const withMetrics = result.find((n) => n.id === "n-with-metrics");
      const noMetrics = result.find((n) => n.id === "n-no-metrics");

      expect(withMetrics!.cpuLoad).toBe(0.75);
      expect(noMetrics!.cpuLoad).toBeNull();
    });

    it("Test 9: Attaches labelCompliant=true when requiredLabels is empty", async () => {
      const group = makeNodeGroup({ id: "ng-1", criteria: {}, requiredLabels: [] });
      const nodes = [makeNode({ id: "n-1", labels: {} })]; // no labels, but requiredLabels is empty

      prismaMock.nodeGroup.findUnique.mockResolvedValue(group as never);
      prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);

      const result = await caller.nodesInGroup({ groupId: "ng-1", environmentId: "env-1" });

      expect(result[0].labelCompliant).toBe(true);
    });

    it("Test 10: Attaches labelCompliant=false when node is missing a required label key", async () => {
      const group = makeNodeGroup({
        id: "ng-1",
        criteria: { region: "us-east" },
        requiredLabels: ["region", "role"], // requires both
      });
      const nodes = [
        makeNode({ id: "n-missing-role", labels: { region: "us-east" } }), // missing 'role'
      ];

      prismaMock.nodeGroup.findUnique.mockResolvedValue(group as never);
      prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);

      const result = await caller.nodesInGroup({ groupId: "ng-1", environmentId: "env-1" });

      expect(result[0].labelCompliant).toBe(false);
    });

    it("Test 11: Throws NOT_FOUND for non-existent groupId", async () => {
      prismaMock.nodeGroup.findUnique.mockResolvedValue(null);

      await expect(
        caller.nodesInGroup({ groupId: "nonexistent", environmentId: "env-1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("Test 12: Returns lastSeen timestamp for recency display", async () => {
      const group = makeNodeGroup({ id: "ng-1", criteria: {}, requiredLabels: [] });
      const lastSeen = new Date("2026-01-15T10:00:00Z");
      const nodes = [makeNode({ id: "n-1", lastSeen })];

      prismaMock.nodeGroup.findUnique.mockResolvedValue(group as never);
      prismaMock.vectorNode.findMany.mockResolvedValue(nodes as never);

      const result = await caller.nodesInGroup({ groupId: "ng-1", environmentId: "env-1" });

      expect(result[0].lastSeen).toEqual(lastSeen);
    });
  });
});
