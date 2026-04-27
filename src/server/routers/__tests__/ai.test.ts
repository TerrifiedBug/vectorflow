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

import { prisma } from "@/lib/prisma";
import { aiRouter } from "@/server/routers/ai";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(aiRouter)({
  session: { user: { id: "user-1", email: "test@test.com", name: "Test User" } },
  userRole: "ADMIN",
  teamId: "team-1",
});

const NOW = new Date("2026-03-01T12:00:00Z");

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    pipelineId: "pipe-1",
    componentKey: null,
    createdById: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
    messages: [],
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    role: "assistant",
    content: "test content",
    suggestions: [{ id: "sug-1", title: "Fix config" }],
    createdById: "user-1",
    createdAt: NOW,
    conversation: { pipelineId: "pipe-1", componentKey: null },
    ...overrides,
  };
}

describe("aiRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
    vi.clearAllMocks();
  });

  describe("getConversation", () => {
    it("returns the latest conversation for a pipeline with componentKey null", async () => {
      const conv = makeConversation();
      prismaMock.aiConversation.findFirst.mockResolvedValueOnce(conv as never);

      const result = await caller.getConversation({ pipelineId: "pipe-1" });

      expect(result).toEqual(conv);
      expect(prismaMock.aiConversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pipelineId: "pipe-1", componentKey: null },
          orderBy: { createdAt: "desc" },
        }),
      );
    });

    it("returns null when no conversation exists", async () => {
      prismaMock.aiConversation.findFirst.mockResolvedValueOnce(null);

      const result = await caller.getConversation({ pipelineId: "pipe-1" });

      expect(result).toBeNull();
    });
  });

  describe("startNewConversation", () => {
    it("creates a new conversation for the pipeline", async () => {
      const conv = makeConversation();
      prismaMock.aiConversation.create.mockResolvedValueOnce(conv as never);

      const result = await caller.startNewConversation({ pipelineId: "pipe-1" });

      expect(result).toEqual(conv);
      expect(prismaMock.aiConversation.create).toHaveBeenCalledWith({
        data: {
          pipelineId: "pipe-1",
          createdById: "user-1",
        },
      });
    });
  });

  describe("markSuggestionsApplied", () => {
    it("marks suggestions as applied on a valid message", async () => {
      const msg = makeMessage();
      prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => {
        return fn(prismaMock);
      });
      prismaMock.aiMessage.findUnique.mockResolvedValueOnce(msg as never);
      prismaMock.aiMessage.update.mockResolvedValueOnce({} as never);

      const result = await caller.markSuggestionsApplied({
        pipelineId: "pipe-1",
        conversationId: "conv-1",
        messageId: "msg-1",
        suggestionIds: ["sug-1"],
      });

      expect(result).toEqual({ applied: 1 });
      expect(prismaMock.aiMessage.update).toHaveBeenCalledOnce();
    });

    it("throws NOT_FOUND when message does not exist", async () => {
      prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => {
        return fn(prismaMock);
      });
      prismaMock.aiMessage.findUnique.mockResolvedValueOnce(null);

      await expect(
        caller.markSuggestionsApplied({
          pipelineId: "pipe-1",
          conversationId: "conv-1",
          messageId: "missing",
          suggestionIds: ["sug-1"],
        }),
      ).rejects.toThrow("Message not found in conversation");
    });

    it("throws NOT_FOUND when conversationId does not match", async () => {
      const msg = makeMessage({ conversationId: "conv-other" });
      prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => {
        return fn(prismaMock);
      });
      prismaMock.aiMessage.findUnique.mockResolvedValueOnce(msg as never);

      await expect(
        caller.markSuggestionsApplied({
          pipelineId: "pipe-1",
          conversationId: "conv-1",
          messageId: "msg-1",
          suggestionIds: ["sug-1"],
        }),
      ).rejects.toThrow("Message not found in conversation");
    });
  });

  describe("getDebugConversation", () => {
    it("filters by componentKey __debug__", async () => {
      const conv = makeConversation({ componentKey: "__debug__" });
      prismaMock.aiConversation.findFirst.mockResolvedValueOnce(conv as never);

      const result = await caller.getDebugConversation({ pipelineId: "pipe-1" });

      expect(result).toEqual(conv);
      expect(prismaMock.aiConversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pipelineId: "pipe-1", componentKey: "__debug__" },
        }),
      );
    });
  });

  describe("getVrlConversation", () => {
    it("returns conversation for a specific componentKey", async () => {
      const conv = makeConversation({ componentKey: "my_transform" });
      prismaMock.aiConversation.findFirst.mockResolvedValueOnce(conv as never);

      const result = await caller.getVrlConversation({
        pipelineId: "pipe-1",
        componentKey: "my_transform",
      });

      expect(result).toEqual(conv);
      expect(prismaMock.aiConversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pipelineId: "pipe-1", componentKey: "my_transform" },
        }),
      );
    });
  });

  describe("markVrlSuggestionsApplied", () => {
    it("marks VRL suggestions as applied on a valid message", async () => {
      const msg = makeMessage({
        conversation: { pipelineId: "pipe-1", componentKey: "my_transform" },
      });
      prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => {
        return fn(prismaMock);
      });
      prismaMock.aiMessage.findUnique.mockResolvedValueOnce(msg as never);
      prismaMock.aiMessage.update.mockResolvedValueOnce({} as never);

      const result = await caller.markVrlSuggestionsApplied({
        pipelineId: "pipe-1",
        conversationId: "conv-1",
        messageId: "msg-1",
        suggestionIds: ["sug-1", "sug-2"],
      });

      expect(result).toEqual({ applied: 2 });
    });

    it("throws NOT_FOUND when message pipelineId does not match", async () => {
      const msg = makeMessage({
        conversation: { pipelineId: "pipe-other", componentKey: "my_transform" },
      });
      prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => {
        return fn(prismaMock);
      });
      prismaMock.aiMessage.findUnique.mockResolvedValueOnce(msg as never);

      await expect(
        caller.markVrlSuggestionsApplied({
          pipelineId: "pipe-1",
          conversationId: "conv-1",
          messageId: "msg-1",
          suggestionIds: ["sug-1"],
        }),
      ).rejects.toThrow("Message not found in conversation");
    });
  });
});
