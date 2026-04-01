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

vi.mock("@/lib/vrl/snippets", () => ({
  VRL_SNIPPETS: [
    {
      id: "parse-json",
      name: "parse_json",
      description: "Parse JSON from .message",
      category: "Parsing",
      code: '. = merge!(., parse_json!(.message))',
    },
  ],
}));

import { prisma } from "@/lib/prisma";
import { vrlSnippetRouter } from "@/server/routers/vrl-snippet";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(vrlSnippetRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

const NOW = new Date("2026-03-01T12:00:00Z");

function makeSnippet(overrides: Record<string, unknown> = {}) {
  return {
    id: "snip-1",
    teamId: "team-1",
    name: "Custom Parse",
    description: "A custom snippet",
    category: "Parsing",
    code: '.custom = "value"',
    createdBy: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("vrlSnippetRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns builtIn snippets from VRL_SNIPPETS and custom from DB", async () => {
      const customSnippets = [makeSnippet()];
      prismaMock.vrlSnippet.findMany.mockResolvedValueOnce(customSnippets as never);

      const result = await caller.list({ teamId: "team-1" });

      expect(result.builtIn).toHaveLength(1);
      expect(result.builtIn[0].id).toBe("parse-json");
      expect(result.custom).toHaveLength(1);
      expect(result.custom[0].name).toBe("Custom Parse");
      expect(result.custom[0].isCustom).toBe(true);
    });

    it("returns empty custom array when no custom snippets exist", async () => {
      prismaMock.vrlSnippet.findMany.mockResolvedValueOnce([] as never);

      const result = await caller.list({ teamId: "team-1" });

      expect(result.builtIn).toHaveLength(1);
      expect(result.custom).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("creates a custom VRL snippet with createdBy from context", async () => {
      const snippet = makeSnippet();
      prismaMock.vrlSnippet.create.mockResolvedValueOnce(snippet as never);

      const result = await caller.create({
        teamId: "team-1",
        name: "Custom Parse",
        description: "A custom snippet",
        category: "Parsing",
        code: '.custom = "value"',
      });

      expect(result.name).toBe("Custom Parse");
      expect(prismaMock.vrlSnippet.create).toHaveBeenCalledWith({
        data: {
          teamId: "team-1",
          name: "Custom Parse",
          description: "A custom snippet",
          category: "Parsing",
          code: '.custom = "value"',
          createdBy: "user-1",
        },
      });
    });
  });

  describe("update", () => {
    it("updates a snippet with partial fields", async () => {
      const updated = makeSnippet({ name: "Updated Name" });
      prismaMock.vrlSnippet.update.mockResolvedValueOnce(updated as never);

      const result = await caller.update({
        id: "snip-1",
        name: "Updated Name",
      });

      expect(result.name).toBe("Updated Name");
      expect(prismaMock.vrlSnippet.update).toHaveBeenCalledWith({
        where: { id: "snip-1" },
        data: { name: "Updated Name" },
      });
    });

    it("updates only the code field", async () => {
      const updated = makeSnippet({ code: ".new_code = true" });
      prismaMock.vrlSnippet.update.mockResolvedValueOnce(updated as never);

      const result = await caller.update({
        id: "snip-1",
        code: ".new_code = true",
      });

      expect(result.code).toBe(".new_code = true");
      expect(prismaMock.vrlSnippet.update).toHaveBeenCalledWith({
        where: { id: "snip-1" },
        data: { code: ".new_code = true" },
      });
    });
  });

  describe("delete", () => {
    it("deletes a snippet by ID", async () => {
      const snippet = makeSnippet();
      prismaMock.vrlSnippet.delete.mockResolvedValueOnce(snippet as never);

      const result = await caller.delete({ id: "snip-1" });

      expect(result.id).toBe("snip-1");
      expect(prismaMock.vrlSnippet.delete).toHaveBeenCalledWith({
        where: { id: "snip-1" },
      });
    });
  });
});
