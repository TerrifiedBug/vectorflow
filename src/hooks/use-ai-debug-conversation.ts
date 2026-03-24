"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";

export interface DebugConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  createdBy?: { id: string; name: string | null; image: string | null } | null;
}

interface UseAiDebugConversationOptions {
  pipelineId: string;
  currentYaml?: string;
}

export function useAiDebugConversation({
  pipelineId,
  currentYaml,
}: UseAiDebugConversationOptions) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const [messages, setMessages] = useState<DebugConversationMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isNewConversationRef = useRef(false);

  // Load existing conversation
  const conversationQuery = useQuery({
    ...trpc.ai.getDebugConversation.queryOptions({ pipelineId }),
    enabled: !!pipelineId,
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
        createdAt:
          m.createdAt instanceof Date
            ? m.createdAt.toISOString()
            : String(m.createdAt),
        createdBy: m.createdBy,
      })),
    );
  }

  const sendMessage = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || !selectedTeamId || isStreaming) return;

      isNewConversationRef.current = false;
      setIsStreaming(true);
      setStreamingContent("");
      setError(null);

      // Add optimistic user message
      const userMessage: DebugConversationMessage = {
        id: `temp-user-${Date.now()}`,
        role: "user",
        content: prompt.trim(),
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      abortRef.current = new AbortController();
      let fullResponse = "";

      try {
        const response = await fetch("/api/ai/debug", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: selectedTeamId,
            prompt: prompt.trim(),
            pipelineId,
            currentYaml,
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

        // Add assistant message on completion
        const assistantMessage: DebugConversationMessage = {
          id: `temp-assistant-${Date.now()}`,
          role: "assistant",
          content: fullResponse,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setStreamingContent("");

        // Refetch to sync local state with server-persisted messages (real IDs)
        const refetched = await queryClient.fetchQuery({
          ...trpc.ai.getDebugConversation.queryOptions({ pipelineId }),
          staleTime: 0,
        });
        if (refetched?.messages) {
          setMessages(
            refetched.messages.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
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
      pipelineId,
      currentYaml,
      conversationId,
      queryClient,
      trpc,
    ],
  );

  const startNewConversation = useCallback(() => {
    isNewConversationRef.current = true;
    queryClient.removeQueries({
      queryKey: trpc.ai.getDebugConversation.queryKey({ pipelineId }),
    });
    setMessages([]);
    setConversationId(null);
    setStreamingContent("");
    setError(null);
  }, [queryClient, trpc, pipelineId]);

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
    cancelStreaming,
  };
}
