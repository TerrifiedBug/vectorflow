// src/components/flow/ai-pipeline-dialog.tsx
"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Loader2, RotateCcw, Sparkles, AlertTriangle, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useTeamStore } from "@/stores/team-store";
import { useFlowStore } from "@/stores/flow-store";
import { generateVectorYaml, importVectorConfig } from "@/lib/config-generator";
import { toast } from "sonner";
import { useAiConversation } from "@/hooks/use-ai-conversation";
import { AiMessageBubble } from "./ai-message-bubble";
import { validateSuggestions } from "@/lib/ai/suggestion-validator";
import { detectOutdatedSuggestions } from "@/lib/ai/suggestion-validator";
import type { AiSuggestion, SuggestionStatus } from "@/lib/ai/types";

interface AiPipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  environmentName?: string;
}

export function AiPipelineDialog({
  open,
  onOpenChange,
  pipelineId,
  environmentName,
}: AiPipelineDialogProps) {
  const [mode, setMode] = useState<"generate" | "review">("generate");

  // --- Generate tab state (unchanged from original) ---
  const [genPrompt, setGenPrompt] = useState("");
  const genTextareaRef = useRef<HTMLTextAreaElement>(null);
  const reviewTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [genResult, setGenResult] = useState("");
  const [genIsStreaming, setGenIsStreaming] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const genAbortRef = useRef<AbortController | null>(null);
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const globalConfig = useFlowStore((s) => s.globalConfig);
  const loadGraph = useFlowStore((s) => s.loadGraph);
  const applySuggestions = useFlowStore((s) => s.applySuggestions);

  const currentYaml = nodes.length > 0
    ? generateVectorYaml(nodes, edges, globalConfig)
    : undefined;

  // --- Review tab state ---
  const [reviewPrompt, setReviewPrompt] = useState("");
  const conversation = useAiConversation({
    pipelineId,
    currentYaml,
    environmentName,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages, conversation.streamingContent]);

  // Auto-grow for generate textarea
  useEffect(() => {
    const ta = genTextareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxHeight = 4 * 24; // 4 lines
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [genPrompt]);

  // Auto-grow for review textarea
  useEffect(() => {
    const ta = reviewTextareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxHeight = 4 * 24;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [reviewPrompt]);

  // Compute suggestion statuses across all messages
  const suggestionStatuses = useMemo(() => {
    const statuses = new Map<string, SuggestionStatus>();

    for (const msg of conversation.messages) {
      if (msg.role !== "assistant" || !msg.suggestions) continue;

      // Validate references against current canvas
      const validation = validateSuggestions(msg.suggestions, nodes);
      for (const [id, status] of validation) {
        statuses.set(id, status);
      }

      // Additional validation for modify_vrl: configPath must point to a string
      for (const s of msg.suggestions) {
        if (s.type === "modify_vrl" && statuses.get(s.id) === "actionable") {
          const node = nodes.find((n) => (n.data as Record<string, unknown>).componentKey === s.componentKey);
          if (node) {
            const config = (node.data as Record<string, unknown>).config as Record<string, unknown>;
            let value: unknown = config;
            for (const part of s.configPath.split(".")) {
              if (value == null || typeof value !== "object") { value = undefined; break; }
              value = (value as Record<string, unknown>)[part];
            }
            if (typeof value !== "string") {
              statuses.set(s.id, "invalid");
            } else if (!value.includes(s.targetCode)) {
              statuses.set(s.id, "outdated");
            }
          }
        }
      }

      // Check for outdated suggestions
      const outdated = detectOutdatedSuggestions(
        msg.suggestions,
        msg.pipelineYaml ?? null,
        currentYaml ?? "",
      );
      for (const id of outdated) {
        if (statuses.get(id) === "actionable") {
          statuses.set(id, "outdated");
        }
      }

      // Check for already-applied suggestions (from server data)
      for (const s of msg.suggestions) {
        const raw = s as unknown as Record<string, unknown>;
        if (raw.appliedAt) {
          statuses.set(s.id, "applied");
        }
      }
    }

    return statuses;
  }, [conversation.messages, nodes, currentYaml]);

  // --- Generate tab handlers (identical to original) ---

  const handleGenSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!genPrompt.trim() || !selectedTeamId || genIsStreaming) return;

      setGenIsStreaming(true);
      setGenResult("");
      setGenError(null);

      genAbortRef.current = new AbortController();

      try {
        const response = await fetch("/api/ai/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: selectedTeamId,
            prompt: genPrompt.trim(),
            mode: "generate",
            currentYaml: undefined,
            environmentName,
          }),
          signal: genAbortRef.current.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({ error: "Request failed" }));
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
              if (data.done) break;
              if (data.error) throw new Error(data.error);
              if (data.token) {
                setGenResult((prev) => prev + data.token);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") {
                throw parseErr;
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setGenError(err instanceof Error ? err.message : "AI request failed");
      } finally {
        setGenIsStreaming(false);
        genAbortRef.current = null;
      }
    },
    [genPrompt, selectedTeamId, environmentName, genIsStreaming],
  );

  const handleApplyToCanvas = () => {
    try {
      let yaml = genResult.trim();
      if (yaml.startsWith("```yaml")) yaml = yaml.slice(7);
      if (yaml.startsWith("```")) yaml = yaml.slice(3);
      if (yaml.endsWith("```")) yaml = yaml.slice(0, -3);
      yaml = yaml.trim();

      const { nodes: newNodes, edges: newEdges, globalConfig: importedGlobalConfig } =
        importVectorConfig(yaml);

      if (nodes.length === 0) {
        loadGraph(newNodes, newEdges, importedGlobalConfig);
      } else {
        const maxY = Math.max(...nodes.map((n) => n.position.y), 0);
        const offsetNodes = newNodes.map((n) => ({
          ...n,
          position: { x: n.position.x, y: n.position.y + maxY + 200 },
        }));
        const mergedConfig = importedGlobalConfig
          ? { ...importedGlobalConfig, ...globalConfig }
          : globalConfig;
        loadGraph([...nodes, ...offsetNodes], [...edges, ...newEdges], mergedConfig);
      }

      toast.success(`Applied ${newNodes.length} components to canvas`);
      onOpenChange(false);
      setGenResult("");
      setGenPrompt("");
    } catch (err) {
      toast.error("Failed to parse YAML", {
        description: err instanceof Error ? err.message : "Invalid YAML output",
      });
    }
  };

  const handleGenCancel = () => {
    genAbortRef.current?.abort();
  };

  const handleGenKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenSubmit();
    }
  };

  // --- Review tab handlers ---

  const handleReviewSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!reviewPrompt.trim()) return;
      const prompt = reviewPrompt;
      setReviewPrompt("");
      conversation.sendReview(prompt);
    },
    [reviewPrompt, conversation],
  );

  const handleReviewKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleReviewSubmit();
    }
  };

  const handleApplySelected = useCallback(
    (messageId: string, suggestions: AiSuggestion[]) => {
      const { applied, errors } = applySuggestions(suggestions);

      if (applied > 0) {
        toast.success(`Applied ${applied} suggestion${applied > 1 ? "s" : ""} to canvas`);
        conversation.markSuggestionsApplied(
          messageId,
          suggestions.map((s) => s.id),
        );
      }
      if (errors.length > 0) {
        toast.error(`${errors.length} suggestion${errors.length > 1 ? "s" : ""} failed`, {
          description: errors[0],
        });
      }
    },
    [applySuggestions, conversation],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col min-h-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Pipeline Builder
          </DialogTitle>
          <DialogDescription>
            Describe what you want to build, or ask for a review of your current pipeline.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "generate" | "review")} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="generate">Generate</TabsTrigger>
            <TabsTrigger value="review" disabled={nodes.length === 0}>
              Review
            </TabsTrigger>
          </TabsList>

          {/* ---- Generate tab (unchanged) ---- */}
          <TabsContent value="generate" className="space-y-4 mt-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="ai-pipeline-prompt">Describe your pipeline</Label>
              <form onSubmit={handleGenSubmit} className="flex gap-2">
                <textarea
                  ref={genTextareaRef}
                  id="ai-pipeline-prompt"
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  onKeyDown={handleGenKeyDown}
                  placeholder="Collect K8s logs, drop debug, send to Datadog and S3"
                  disabled={genIsStreaming}
                  rows={1}
                  className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
                {genIsStreaming ? (
                  <Button type="button" variant="outline" size="sm" onClick={handleGenCancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button type="submit" size="sm" disabled={!genPrompt.trim()}>
                    Generate
                  </Button>
                )}
              </form>
            </div>

            {genError && (
              <div className="flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {genError}
              </div>
            )}

            {(genResult || genIsStreaming) && (
              <div className="space-y-3">
                <Label>Result</Label>
                <div className="relative rounded border bg-muted/50 p-3 font-mono text-sm whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                  {genResult || (
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Generating pipeline...
                    </span>
                  )}
                </div>
                {!genIsStreaming && genResult && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleApplyToCanvas}>
                      Apply to Canvas
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setGenResult(""); handleGenSubmit(); }}>
                      <RotateCcw className="mr-1.5 h-3 w-3" />
                      Regenerate
                    </Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* ---- Review tab (conversation thread) ---- */}
          <TabsContent value="review" className="flex flex-col flex-1 mt-4 min-h-0 overflow-hidden">
            {conversation.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Message thread */}
                <div className="flex-1 min-h-0 overflow-y-auto pr-4">
                  <div className="space-y-4 pb-4">
                    {conversation.messages.length === 0 && !conversation.isStreaming && (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        Ask the AI to review your pipeline configuration.
                      </p>
                    )}

                    {conversation.messages.map((msg) => (
                      <AiMessageBubble
                        key={msg.id}
                        message={msg}
                        suggestionStatuses={suggestionStatuses}
                        onApplySelected={handleApplySelected}
                      />
                    ))}

                    {conversation.isStreaming && conversation.streamingContent && (
                      <div className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600 dark:text-violet-400" />
                        </div>
                        <div className="flex-1 pt-0.5">
                          <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {conversation.streamingContent}
                          </div>
                        </div>
                      </div>
                    )}

                    {conversation.isStreaming && !conversation.streamingContent && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Analyzing pipeline...
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {conversation.error && (
                  <div className="flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive mb-3">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    {conversation.error}
                  </div>
                )}

                {/* Input pinned at bottom */}
                <div className="pt-3 border-t space-y-2">
                  <form onSubmit={handleReviewSubmit} className="flex gap-2">
                    <textarea
                      ref={reviewTextareaRef}
                      value={reviewPrompt}
                      onChange={(e) => setReviewPrompt(e.target.value)}
                      onKeyDown={handleReviewKeyDown}
                      placeholder="Ask about your pipeline..."
                      disabled={conversation.isStreaming}
                      rows={1}
                      className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                    />
                    {conversation.isStreaming ? (
                      <Button type="button" variant="outline" size="sm" onClick={conversation.cancelStreaming}>
                        Cancel
                      </Button>
                    ) : (
                      <Button type="submit" size="sm" disabled={!reviewPrompt.trim()}>
                        Review
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
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
