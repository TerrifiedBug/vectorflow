// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Hoisted mocks (available inside vi.mock factories) ───────────────

const { mockQueryClient, mockMutate, mockTrpc } = vi.hoisted(() => ({
  mockQueryClient: {
    invalidateQueries: vi.fn(),
    removeQueries: vi.fn(),
    fetchQuery: vi.fn(),
  },
  mockMutate: vi.fn(),
  mockTrpc: {
    ai: {
      getConversation: {
        queryOptions: vi.fn((input: unknown) => ({
          queryKey: ["ai", "getConversation", input],
          queryFn: vi.fn(),
        })),
        queryKey: vi.fn((input: unknown) => ["ai", "getConversation", input]),
      },
      markSuggestionsApplied: {
        mutationOptions: vi.fn((o: unknown) => o),
      },
    },
  },
}));

// ── Module mocks ─────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
  useMutation: vi.fn(() => {
    return { mutate: mockMutate, isPending: false };
  }),
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

vi.mock("@/lib/ai/suggestion-validator", () => ({
  parseAiReviewResponse: vi.fn(() => null),
}));

// ── Import under test (after mocks) ─────────────────────────────────

import { useAiConversation } from "../use-ai-conversation";
import { useQuery } from "@tanstack/react-query";

// ── Helpers ──────────────────────────────────────────────────────────

function renderConversationHook() {
  return renderHook(() =>
    useAiConversation({
      pipelineId: "pipe-1",
      currentYaml: "sources: {}",
      environmentName: "production",
    }),
  );
}

// ── Tests ────────────────────────────────────────────────────────────

describe("useAiConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns initial state with empty messages and isStreaming false", () => {
    const { result } = renderConversationHook();

    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe("");
    expect(result.current.error).toBeNull();
    expect(result.current.conversationId).toBeNull();
  });

  it("syncs messages when query data is available", () => {
    const conversationData = {
      id: "conv-1",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "Review my pipeline",
          suggestions: undefined,
          pipelineYaml: "sources: {}",
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: null,
        },
        {
          id: "msg-2",
          role: "assistant",
          content: "Looks good",
          suggestions: undefined,
          pipelineYaml: null,
          createdAt: "2026-01-01T00:00:01.000Z",
          createdBy: null,
        },
      ],
    };

    vi.mocked(useQuery).mockReturnValue({
      data: conversationData,
      isLoading: false,
    } as ReturnType<typeof useQuery>);

    const { result } = renderConversationHook();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].id).toBe("msg-1");
    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[1].id).toBe("msg-2");
    expect(result.current.messages[1].role).toBe("assistant");
    expect(result.current.conversationId).toBe("conv-1");
  });

  it("markSuggestionsApplied calls mutation with correct args", () => {
    const conversationData = {
      id: "conv-1",
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "suggestions here",
          suggestions: [{ id: "sug-1" }],
          pipelineYaml: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: null,
        },
      ],
    };

    vi.mocked(useQuery).mockReturnValue({
      data: conversationData,
      isLoading: false,
    } as ReturnType<typeof useQuery>);

    const { result } = renderConversationHook();

    act(() => {
      result.current.markSuggestionsApplied("msg-1", ["sug-1"]);
    });

    expect(mockMutate).toHaveBeenCalledWith({
      pipelineId: "pipe-1",
      conversationId: "conv-1",
      messageId: "msg-1",
      suggestionIds: ["sug-1"],
    });
  });

  it("markSuggestionsApplied skips temp message IDs", () => {
    const conversationData = {
      id: "conv-1",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "test",
          suggestions: undefined,
          pipelineYaml: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: null,
        },
      ],
    };

    vi.mocked(useQuery).mockReturnValue({
      data: conversationData,
      isLoading: false,
    } as ReturnType<typeof useQuery>);

    const { result } = renderConversationHook();

    act(() => {
      result.current.markSuggestionsApplied("temp-msg-1", ["sug-1"]);
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("startNewConversation resets all state", () => {
    const conversationData = {
      id: "conv-1",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "hello",
          suggestions: undefined,
          pipelineYaml: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: null,
        },
      ],
    };

    vi.mocked(useQuery).mockReturnValue({
      data: conversationData,
      isLoading: false,
    } as ReturnType<typeof useQuery>);

    const { result } = renderConversationHook();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.conversationId).toBe("conv-1");

    act(() => {
      result.current.startNewConversation();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();
    expect(result.current.streamingContent).toBe("");
    expect(result.current.error).toBeNull();
    expect(mockQueryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ["ai", "getConversation", { pipelineId: "pipe-1" }],
    });
  });

  it("cancelStreaming does not throw when no active stream", () => {
    const { result } = renderConversationHook();

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

    const { result } = renderConversationHook();
    expect(result.current.isLoading).toBe(true);
  });
});
