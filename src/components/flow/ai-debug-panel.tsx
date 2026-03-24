"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bug,
  Bot,
  User,
  Loader2,
  Send,
  AlertTriangle,
  MessageSquarePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAiDebugConversation } from "@/hooks/use-ai-debug-conversation";

interface AiDebugPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  currentYaml?: string;
}

export function AiDebugPanel({
  open,
  onOpenChange,
  pipelineId,
  currentYaml,
}: AiDebugPanelProps) {
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const conversation = useAiDebugConversation({ pipelineId, currentYaml });

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages, conversation.streamingContent]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxHeight = 4 * 24; // 4 lines
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [prompt]);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!prompt.trim()) return;
      const message = prompt;
      setPrompt("");
      conversation.sendMessage(message);
    },
    [prompt, conversation],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col min-h-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4" />
            Debug with AI
          </DialogTitle>
          <DialogDescription>
            Ask questions about your pipeline&apos;s configuration, metrics, and
            errors
          </DialogDescription>
        </DialogHeader>

        {conversation.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Message thread */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-2">
              <div className="space-y-4 pb-4">
                {conversation.messages.length === 0 &&
                  !conversation.isStreaming && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Ask the AI to help debug your pipeline — it has access to
                      your configuration, metrics, SLI health, and recent error
                      logs.
                    </p>
                  )}

                {conversation.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-3 ${
                      msg.role === "user" ? "flex-row-reverse" : ""
                    }`}
                  >
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        msg.role === "user"
                          ? "bg-primary/10"
                          : "bg-violet-500/10"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <User className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Bot className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                      )}
                    </div>
                    <div
                      className={`flex-1 pt-0.5 ${
                        msg.role === "user" ? "text-right" : ""
                      }`}
                    >
                      <div
                        className={`inline-block rounded-lg px-3 py-2 text-sm ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <div className="whitespace-pre-wrap">
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Streaming content */}
                {conversation.isStreaming && conversation.streamingContent && (
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600 dark:text-violet-400" />
                    </div>
                    <div className="flex-1 pt-0.5">
                      <div className="inline-block rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
                        {conversation.streamingContent}
                      </div>
                    </div>
                  </div>
                )}

                {/* Streaming placeholder (waiting for first token) */}
                {conversation.isStreaming && !conversation.streamingContent && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Analyzing pipeline...
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Error display */}
            {conversation.error && (
              <div className="flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive mb-3">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {conversation.error}
              </div>
            )}

            {/* Input pinned at bottom */}
            <div className="pt-3 border-t space-y-2">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Why is this pipeline dropping events?"
                  disabled={conversation.isStreaming}
                  rows={1}
                  className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
                {conversation.isStreaming ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={conversation.cancelStreaming}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!prompt.trim()}
                  >
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                    Send
                  </Button>
                )}
              </form>
              {conversation.messages.length > 0 && (
                <button
                  type="button"
                  onClick={conversation.startNewConversation}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <MessageSquarePlus className="h-3 w-3" />
                  New Conversation
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
