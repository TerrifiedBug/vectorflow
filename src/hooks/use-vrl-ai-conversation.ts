"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import type { VrlSuggestion } from "@/lib/ai/vrl-suggestion-types";
import { parseVrlChatResponse } from "@/lib/ai/vrl-suggestion-types";

export interface VrlConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestions?: VrlSuggestion[];
  vrlCode?: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string | null; image: string | null } | null;
}

interface UseVrlAiConversationOptions {
  pipelineId: string;
  componentKey: string;
  currentCode?: string;
  fields?: { name: string; type: string }[];
  componentType?: string;
  sourceTypes?: string[];
}

export function useVrlAiConversation({
  pipelineId,
  componentKey,
  currentCode,
  fields,
  componentType,
  sourceTypes,
}: UseVrlAiConversationOptions) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const [messages, setMessages] = useState<VrlConversationMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isNewConversationRef = useRef(false);

  // Load existing conversation
  const conversationQuery = useQuery({
    ...trpc.ai.getVrlConversation.queryOptions({ pipelineId, componentKey }),
    enabled: !!pipelineId && !!componentKey,
  });

  // Sync loaded conversation into local state
  const loadedConversation = conversationQuery.data;
  if (
    loadedConversation &&
    !conversationId &&
    messages.length === 0 &&
    !isStreaming &&
    !isNewConversationRef.current
  ) {
    setConversationId(loadedConversation.id);
    setMessages(
      loadedConversation.messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        suggestions: m.suggestions as unknown as VrlSuggestion[] | undefined,
        vrlCode: m.vrlCode,
        createdAt:
          m.createdAt instanceof Date
            ? m.createdAt.toISOString()
            : String(m.createdAt),
        createdBy: m.createdBy,
      })),
    );
  }

  const markAppliedMutation = useMutation(
    trpc.ai.markVrlSuggestionsApplied.mutationOptions({}),
  );

  const sendMessage = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || !selectedTeamId || isStreaming) return;

      isNewConversationRef.current = false;
      setIsStreaming(true);
      setStreamingContent("");
      setError(null);

      // Add optimistic user message
      const userMessage: VrlConversationMessage = {
        id: `temp-user-${Date.now()}`,
        role: "user",
        content: prompt.trim(),
        vrlCode: currentCode ?? null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      abortRef.current = new AbortController();
      let fullResponse = "";

      try {
        const response = await fetch("/api/ai/vrl-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: selectedTeamId,
            prompt: prompt.trim(),
            currentCode,
            fields,
            componentType,
            sourceTypes,
            pipelineId,
            componentKey,
            conversationId,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const errData = await response
            .json()
            .catch(() => ({ error: "Request failed" }));
          throw new Error(errData.error || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data.conversationId) {
                setConversationId(data.conversationId);
                continue;
              }
              if (data.done) break;
              if (data.error) throw new Error(data.error);
              if (data.token) {
                fullResponse += data.token;
                setStreamingContent(fullResponse);
              }
            } catch (parseErr) {
              if (
                parseErr instanceof Error &&
                parseErr.message !== "Unexpected end of JSON input"
              ) {
                throw parseErr;
              }
            }
          }
        }

        // Parse the completed response
        const parsed = parseVrlChatResponse(fullResponse);

        const assistantMessage: VrlConversationMessage = {
          id: `temp-assistant-${Date.now()}`,
          role: "assistant",
          content: fullResponse,
          suggestions: parsed?.suggestions,
          vrlCode: currentCode ?? null,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setStreamingContent("");

        // Refetch to sync local state with server-persisted messages (real IDs)
        const refetched = await queryClient.fetchQuery({
          ...trpc.ai.getVrlConversation.queryOptions({
            pipelineId,
            componentKey,
          }),
          staleTime: 0,
        });
        if (refetched?.messages) {
          setMessages(
            refetched.messages.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              suggestions: m.suggestions as unknown as
                | VrlSuggestion[]
                | undefined,
              vrlCode: m.vrlCode,
              createdAt:
                m.createdAt instanceof Date
                  ? m.createdAt.toISOString()
                  : String(m.createdAt),
              createdBy: m.createdBy,
            })),
          );
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "AI request failed");
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [
      selectedTeamId,
      isStreaming,
      currentCode,
      fields,
      componentType,
      sourceTypes,
      pipelineId,
      componentKey,
      conversationId,
      queryClient,
      trpc,
    ],
  );

  const startNewConversation = useCallback(() => {
    isNewConversationRef.current = true;
    queryClient.removeQueries({
      queryKey: trpc.ai.getVrlConversation.queryKey({
        pipelineId,
        componentKey,
      }),
    });
    setMessages([]);
    setConversationId(null);
    setStreamingContent("");
    setError(null);
  }, [queryClient, trpc, pipelineId, componentKey]);

  const markSuggestionsApplied = useCallback(
    (messageId: string, suggestionIds: string[]) => {
      if (!conversationId) return;

      // Optimistically update local state so "Applied" badges render immediately
      const now = new Date().toISOString();
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId || !msg.suggestions) return msg;
          return {
            ...msg,
            suggestions: msg.suggestions.map((s) =>
              suggestionIds.includes(s.id)
                ? { ...s, appliedAt: now }
                : s,
            ),
          };
        }),
      );

      // Skip server mutation for temp messages (not yet persisted)
      if (messageId.startsWith("temp-")) return;

      markAppliedMutation.mutate({
        pipelineId,
        conversationId,
        messageId,
        suggestionIds,
      });
    },
    [conversationId, pipelineId, markAppliedMutation],
  );

  const cancelStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    conversationId,
    isStreaming,
    streamingContent,
    error,
    isLoading: conversationQuery.isLoading,
    sendMessage,
    startNewConversation,
    markSuggestionsApplied,
    cancelStreaming,
  };
}
