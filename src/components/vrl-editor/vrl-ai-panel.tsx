"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Loader2, RotateCcw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VrlAiMessage } from "./vrl-ai-message";
import { applyVrlSuggestion } from "@/lib/ai/vrl-suggestion-types";
import type { VrlSuggestion } from "@/lib/ai/vrl-suggestion-types";
import type { useVrlAiConversation } from "@/hooks/use-vrl-ai-conversation";

type ConversationReturn = ReturnType<typeof useVrlAiConversation>;

interface VrlAiPanelProps {
  conversation: ConversationReturn;
  currentCode: string;
  onCodeChange: (code: string) => void;
  onClose: () => void;
}

export function VrlAiPanel({
  conversation,
  currentCode,
  onCodeChange,
  onClose,
}: VrlAiPanelProps) {
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages, conversation.streamingContent]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxHeight = 4 * 24; // 4 lines × ~24px line height
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [prompt]);

  const handleSend = useCallback(() => {
    if (!prompt.trim() || conversation.isStreaming) return;
    conversation.sendMessage(prompt.trim());
    setPrompt("");
  }, [prompt, conversation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleApplySelected = useCallback(
    (messageId: string, suggestions: VrlSuggestion[]) => {
      let code = currentCode;
      const appliedIds: string[] = [];

      for (const suggestion of suggestions) {
        const result = applyVrlSuggestion(suggestion, code);
        if (result !== null) {
          code = result;
          appliedIds.push(suggestion.id);
        }
      }

      if (appliedIds.length > 0) {
        onCodeChange(code);
        conversation.markSuggestionsApplied(messageId, appliedIds);
      }
    },
    [currentCode, onCodeChange, conversation],
  );

  return (
    <div className="flex flex-col h-full border-l">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <span className="text-sm font-medium">AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={conversation.startNewConversation}
            disabled={conversation.isStreaming}
            className="text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            New
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {conversation.isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-sm">Loading conversation...</span>
          </div>
        )}

        {conversation.messages.map((msg) => (
          <VrlAiMessage
            key={msg.id}
            message={msg}
            currentCode={currentCode}
            onApplySelected={handleApplySelected}
          />
        ))}

        {/* Streaming indicator */}
        {conversation.isStreaming && (
          <div className="flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
              <Bot className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="flex-1 pt-0.5">
              {conversation.streamingContent ? (
                <div className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {conversation.streamingContent}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking...
                </span>
              )}
            </div>
          </div>
        )}

        {conversation.error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {conversation.error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t px-4 py-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your VRL code..."
            disabled={conversation.isStreaming}
            rows={1}
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          {conversation.isStreaming ? (
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={conversation.cancelStreaming}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={!prompt.trim()}
              onClick={handleSend}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
