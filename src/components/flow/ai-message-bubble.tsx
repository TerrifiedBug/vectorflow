"use client";

import { useState, useMemo } from "react";
import { Bot, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AiSuggestionCard } from "./ai-suggestion-card";
import { detectConflicts } from "@/lib/ai/conflict-detector";
import type { AiSuggestion, SuggestionStatus } from "@/lib/ai/types";
import type { ConversationMessage } from "@/hooks/use-ai-conversation";

interface AiMessageBubbleProps {
  message: ConversationMessage;
  suggestionStatuses: Map<string, SuggestionStatus>;
  onApplySelected: (messageId: string, suggestions: AiSuggestion[]) => void;
}

export function AiMessageBubble({
  message,
  suggestionStatuses,
  onApplySelected,
}: AiMessageBubbleProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const suggestions = message.suggestions ?? [];
  const hasSuggestions = message.role === "assistant" && suggestions.length > 0;

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

  // Detect conflicts among selected suggestions
  const conflicts = useMemo(() => {
    const selected = suggestions.filter((s) => selectedIds.has(s.id));
    return detectConflicts(selected);
  }, [suggestions, selectedIds]);

  const conflictMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of conflicts) {
      map.set(c.a, c.reason);
      map.set(c.b, c.reason);
    }
    return map;
  }, [conflicts]);

  const actionableSuggestions = suggestions.filter(
    (s) => suggestionStatuses.get(s.id) === "actionable",
  );

  const selectedSuggestions = suggestions.filter((s) => selectedIds.has(s.id));

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
    if (selectedSuggestions.length > 0) {
      onApplySelected(message.id, selectedSuggestions);
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

  // Assistant message
  if (!hasSuggestions) {
    // Fallback: render raw text content
    return (
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
          <Bot className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 pt-0.5">
          <div className="text-sm whitespace-pre-wrap">{message.content}</div>
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
            <AiSuggestionCard
              key={s.id}
              suggestion={s}
              status={suggestionStatuses.get(s.id) ?? "actionable"}
              isSelected={selectedIds.has(s.id)}
              hasConflict={conflictMap.has(s.id)}
              conflictReason={conflictMap.get(s.id)}
              onToggle={handleToggle}
            />
          ))}
        </div>

        {actionableSuggestions.length > 0 && (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleApplyAll}
            >
              Apply All ({actionableSuggestions.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleApplySelected}
              disabled={selectedSuggestions.length === 0}
            >
              Apply Selected{selectedSuggestions.length > 0 ? ` (${selectedSuggestions.length})` : ""}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
