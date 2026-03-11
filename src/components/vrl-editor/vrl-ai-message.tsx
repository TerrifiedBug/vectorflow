"use client";

import { useState, useMemo } from "react";
import { Bot, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VrlSuggestionCard } from "./vrl-suggestion-card";
import type { VrlSuggestion } from "@/lib/ai/vrl-suggestion-types";
import {
  parseVrlChatResponse,
  computeVrlSuggestionStatuses,
} from "@/lib/ai/vrl-suggestion-types";
import type { VrlConversationMessage } from "@/hooks/use-vrl-ai-conversation";

interface VrlAiMessageProps {
  message: VrlConversationMessage;
  currentCode: string;
  onApplySelected: (messageId: string, suggestions: VrlSuggestion[]) => void;
}

export function VrlAiMessage({
  message,
  currentCode,
  onApplySelected,
}: VrlAiMessageProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const suggestions = useMemo(
    () => message.suggestions ?? [],
    [message.suggestions],
  );
  const hasSuggestions =
    message.role === "assistant" && suggestions.length > 0;

  // Parse summary from assistant JSON content
  const summary = useMemo(() => {
    if (message.role !== "assistant") return null;
    if (!hasSuggestions) return null;
    try {
      const parsed = JSON.parse(message.content);
      return parsed.summary as string | undefined;
    } catch {
      return null;
    }
  }, [message.content, message.role, hasSuggestions]);

  // Compute suggestion statuses based on current editor content
  const suggestionStatuses = useMemo(
    () => computeVrlSuggestionStatuses(suggestions, currentCode),
    [suggestions, currentCode],
  );

  const actionableSuggestions = suggestions.filter(
    (s) => suggestionStatuses.get(s.id) === "actionable",
  );

  const selectedSuggestions = suggestions.filter((s) =>
    selectedIds.has(s.id),
  );

  const actionableSelectedSuggestions = selectedSuggestions.filter(
    (s) => suggestionStatuses.get(s.id) === "actionable",
  );

  const handleToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleApplyAll = () => {
    if (actionableSuggestions.length > 0) {
      onApplySelected(message.id, actionableSuggestions);
    }
  };

  const handleApplySelected = () => {
    const applicableSelected = selectedSuggestions.filter(
      (s) => suggestionStatuses.get(s.id) === "actionable",
    );
    if (applicableSelected.length > 0) {
      onApplySelected(message.id, applicableSelected);
    }
  };

  if (message.role === "user") {
    return (
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="flex-1 pt-0.5">
          <p className="text-sm">{message.content}</p>
        </div>
      </div>
    );
  }

  // Assistant message without suggestions — raw text fallback
  if (!hasSuggestions) {
    // Try to extract summary from raw text
    const parsed = parseVrlChatResponse(message.content);
    const displayText = parsed?.summary ?? message.content;

    return (
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
          <Bot className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 pt-0.5">
          <div className="text-sm whitespace-pre-wrap">{displayText}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
        <Bot className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
      </div>
      <div className="flex-1 space-y-3">
        {summary && (
          <p className="text-sm text-muted-foreground">{summary}</p>
        )}

        <div className="space-y-2">
          {suggestions.map((s) => (
            <VrlSuggestionCard
              key={s.id}
              suggestion={s}
              status={suggestionStatuses.get(s.id) ?? "actionable"}
              isSelected={selectedIds.has(s.id)}
              onToggle={handleToggle}
            />
          ))}
        </div>

        {actionableSuggestions.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" onClick={handleApplyAll}>
              Apply All ({actionableSuggestions.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleApplySelected}
              disabled={actionableSelectedSuggestions.length === 0}
            >
              Apply Selected
              {actionableSelectedSuggestions.length > 0
                ? ` (${actionableSelectedSuggestions.length})`
                : ""}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
