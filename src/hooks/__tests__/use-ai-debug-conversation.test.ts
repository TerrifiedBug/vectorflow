// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Hoisted mocks (available inside vi.mock factories) ───────────────

const { mockQueryClient, mockTrpc } = vi.hoisted(() => ({
  mockQueryClient: {
    invalidateQueries: vi.fn(),
    removeQueries: vi.fn(),
    fetchQuery: vi.fn(),
  },
  mockTrpc: {
    ai: {
      getDebugConversation: {
        queryOptions: vi.fn((input: unknown) => ({
          queryKey: ["ai", "getDebugConversation", input],
          queryFn: vi.fn(),
        })),
        queryKey: vi.fn((input: unknown) => [
          "ai",
          "getDebugConversation",
          input,
        ]),
      },
      markSuggestionsApplied: {
        mutationOptions: vi.fn((opts?: unknown) => ({
          mutationFn: vi.fn(),
          ...(opts as Record<string, unknown>),
        })),
      },
    },
  },
}));

// ── Module mocks ─────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: vi.fn(() => mockQueryClient),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: vi.fn(() => mockTrpc),
}));

vi.mock("@/stores/team-store", () => ({
  useTeamStore: vi.fn((selector: (s: { selectedTeamId: string }) => string) =>
    selector({ selectedTeamId: "team-1" }),
  ),
}));

// ── Import under test (after mocks) ─────────────────────────────────

import { useAiDebugConversation } from "../use-ai-debug-conversation";
import { useQuery } from "@tanstack/react-query";

// ── Helpers ──────────────────────────────────────────────────────────

function renderDebugHook() {
  return renderHook(() =>
    useAiDebugConversation({
      pipelineId: "pipe-1",
      currentYaml: "sources: {}",
    }),
  );
}

// ── Tests ────────────────────────────────────────────────────────────

describe("useAiDebugConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns initial state with empty messages and isStreaming false", () => {
    const { result } = renderDebugHook();

    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe("");
    expect(result.current.error).toBeNull();
    expect(result.current.conversationId).toBeNull();
  });

  it("syncs messages when query data is available", () => {
    const conversationData = {
      id: "debug-conv-1",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "Why is my pipeline failing?",
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: null,
        },
        {
          id: "msg-2",
          role: "assistant",
          content: "Check your source config",
          createdAt: "2026-01-01T00:00:01.000Z",
          createdBy: null,
        },
      ],
    };

    vi.mocked(useQuery).mockReturnValue({
      data: conversationData,
      isLoading: false,
    } as ReturnType<typeof useQuery>);

    const { result } = renderDebugHook();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].id).toBe("msg-1");
    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[0].content).toBe(
      "Why is my pipeline failing?",
    );
    expect(result.current.messages[1].id).toBe("msg-2");
    expect(result.current.messages[1].role).toBe("assistant");
    expect(result.current.conversationId).toBe("debug-conv-1");
  });

  it("syncs messages with Date createdAt objects", () => {
    const conversationData = {
      id: "debug-conv-2",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "help",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          createdBy: { id: "user-1", name: "Danny", image: null },
        },
      ],
    };

    vi.mocked(useQuery).mockReturnValue({
      data: conversationData,
      isLoading: false,
    } as ReturnType<typeof useQuery>);

    const { result } = renderDebugHook();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].createdAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(result.current.messages[0].createdBy?.name).toBe("Danny");
  });

  it("startNewConversation resets all state", () => {
    const conversationData = {
      id: "debug-conv-1",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "debug this",
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: null,
        },
      ],
    };

    vi.mocked(useQuery).mockReturnValue({
      data: conversationData,
      isLoading: false,
    } as ReturnType<typeof useQuery>);

    const { result } = renderDebugHook();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.conversationId).toBe("debug-conv-1");

    act(() => {
      result.current.startNewConversation();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();
    expect(result.current.streamingContent).toBe("");
    expect(result.current.error).toBeNull();
    expect(mockQueryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ["ai", "getDebugConversation", { pipelineId: "pipe-1" }],
    });
  });

  it("cancelStreaming does not throw when no active stream", () => {
    const { result } = renderDebugHook();

    expect(() => {
      act(() => {
        result.current.cancelStreaming();
      });
    }).not.toThrow();
  });

  it("isLoading reflects query loading state", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useQuery>);

    const { result } = renderDebugHook();
    expect(result.current.isLoading).toBe(true);
  });

  it("does not re-sync messages after startNewConversation", () => {
    const conversationData = {
      id: "debug-conv-1",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "old message",
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: null,
        },
      ],
    };

    vi.mocked(useQuery).mockReturnValue({
      data: conversationData,
      isLoading: false,
    } as ReturnType<typeof useQuery>);

    const { result, rerender } = renderDebugHook();

    expect(result.current.messages).toHaveLength(1);

    act(() => {
      result.current.startNewConversation();
    });

    expect(result.current.messages).toEqual([]);

    // Re-render — the old data is still in the query, but isNewConversationRef
    // should prevent re-syncing
    rerender();

    expect(result.current.messages).toEqual([]);
  });
});
