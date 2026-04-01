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

import { prisma } from "@/lib/prisma";
import { templateRouter } from "@/server/routers/template";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(templateRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

const NOW = new Date("2026-03-01T12:00:00Z");

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "tmpl-1",
    name: "Log Pipeline",
    description: "A basic log pipeline template",
    category: "logging",
    teamId: "team-1",
    nodes: [
      {
        id: "n1",
        componentType: "stdin",
        componentKey: "my_source",
        kind: "source",
        config: {},
        positionX: 0,
        positionY: 0,
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("templateRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns templates with nodeCount and edgeCount computed from JSON arrays", async () => {
      const templates = [
        makeTemplate(),
        makeTemplate({
          id: "tmpl-2",
          name: "System Template",
          teamId: null,
          nodes: [],
          edges: [],
        }),
      ];
      prismaMock.template.findMany.mockResolvedValueOnce(templates as never);

      const result = await caller.list({ teamId: "team-1" });

      expect(result).toHaveLength(2);
      expect(result[0].nodeCount).toBe(1);
      expect(result[0].edgeCount).toBe(1);
      expect(result[1].nodeCount).toBe(0);
      expect(result[1].edgeCount).toBe(0);
    });

    it("uses OR filter for team templates and system templates (null teamId)", async () => {
      prismaMock.template.findMany.mockResolvedValueOnce([] as never);

      await caller.list({ teamId: "team-1" });

      expect(prismaMock.template.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { teamId: "team-1" },
              { teamId: null },
            ],
          },
          orderBy: { createdAt: "desc" },
        }),
      );
    });
  });

  describe("get", () => {
    it("returns a single template by ID", async () => {
      const tmpl = makeTemplate();
      prismaMock.template.findUnique.mockResolvedValueOnce(tmpl as never);

      const result = await caller.get({ id: "tmpl-1" });

      expect(result.id).toBe("tmpl-1");
      expect(result.name).toBe("Log Pipeline");
      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(1);
    });

    it("throws NOT_FOUND when template does not exist", async () => {
      prismaMock.template.findUnique.mockResolvedValueOnce(null);

      await expect(caller.get({ id: "missing" })).rejects.toThrow("Template not found");
    });
  });

  describe("create", () => {
    it("creates a custom template for a team", async () => {
      const tmpl = makeTemplate();
      prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team-1" } as never);
      prismaMock.template.create.mockResolvedValueOnce(tmpl as never);

      const result = await caller.create({
        name: "Log Pipeline",
        description: "A basic log pipeline template",
        category: "logging",
        teamId: "team-1",
        nodes: [
          {
            id: "n1",
            componentType: "stdin",
            componentKey: "my_source",
            kind: "source",
            config: {},
            positionX: 0,
            positionY: 0,
          },
        ],
        edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
      });

      expect(result.name).toBe("Log Pipeline");
      expect(prismaMock.template.create).toHaveBeenCalledOnce();
    });

    it("throws NOT_FOUND when team does not exist", async () => {
      prismaMock.team.findUnique.mockResolvedValueOnce(null);

      await expect(
        caller.create({
          name: "Log Pipeline",
          description: "desc",
          category: "logging",
          teamId: "missing-team",
          nodes: [],
          edges: [],
        }),
      ).rejects.toThrow("Team not found");
    });
  });

  describe("delete", () => {
    it("deletes a team-owned template", async () => {
      const tmpl = makeTemplate();
      prismaMock.template.findUnique.mockResolvedValueOnce(tmpl as never);
      prismaMock.template.delete.mockResolvedValueOnce(tmpl as never);

      const result = await caller.delete({ id: "tmpl-1" });

      expect(result.id).toBe("tmpl-1");
    });

    it("throws NOT_FOUND when template does not exist", async () => {
      prismaMock.template.findUnique.mockResolvedValueOnce(null);

      await expect(caller.delete({ id: "missing" })).rejects.toThrow("Template not found");
    });

    it("throws FORBIDDEN when trying to delete a system template (null teamId)", async () => {
      const systemTmpl = makeTemplate({ teamId: null });
      prismaMock.template.findUnique.mockResolvedValueOnce(systemTmpl as never);

      await expect(caller.delete({ id: "tmpl-1" })).rejects.toThrow("System templates cannot be deleted");
    });
  });
});
