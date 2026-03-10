// src/components/flow/ai-pipeline-dialog.tsx
"use client";

import { useState, useRef, useCallback } from "react";
import { Loader2, RotateCcw, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface AiPipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentName?: string;
}

export function AiPipelineDialog({
  open,
  onOpenChange,
  environmentName,
}: AiPipelineDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"generate" | "review">("generate");
  const abortRef = useRef<AbortController | null>(null);
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const globalConfig = useFlowStore((s) => s.globalConfig);
  const loadGraph = useFlowStore((s) => s.loadGraph);

  const currentYaml = nodes.length > 0
    ? generateVectorYaml(nodes, edges, globalConfig)
    : undefined;

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!prompt.trim() || !selectedTeamId || isStreaming) return;

      setIsStreaming(true);
      setResult("");
      setError(null);

      abortRef.current = new AbortController();

      try {
        const response = await fetch("/api/ai/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: selectedTeamId,
            prompt: prompt.trim(),
            mode,
            currentYaml: mode === "review" ? currentYaml : undefined,
            environmentName,
          }),
          signal: abortRef.current.signal,
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
                setResult((prev) => prev + data.token);
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
        setError(err instanceof Error ? err.message : "AI request failed");
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [prompt, selectedTeamId, currentYaml, mode, environmentName, isStreaming],
  );

  const handleApplyToCanvas = () => {
    try {
      // Strip any markdown fencing the LLM might have added
      let yaml = result.trim();
      if (yaml.startsWith("```yaml")) yaml = yaml.slice(7);
      if (yaml.startsWith("```")) yaml = yaml.slice(3);
      if (yaml.endsWith("```")) yaml = yaml.slice(0, -3);
      yaml = yaml.trim();

      const { nodes: newNodes, edges: newEdges, globalConfig: importedGlobalConfig } =
        importVectorConfig(yaml);

      if (nodes.length === 0) {
        // Empty pipeline: replace
        loadGraph(newNodes, newEdges, importedGlobalConfig);
      } else {
        // Existing pipeline: add alongside (offset positions to avoid overlap)
        const maxY = Math.max(...nodes.map((n) => n.position.y), 0);
        const offsetNodes = newNodes.map((n) => ({
          ...n,
          position: { x: n.position.x, y: n.position.y + maxY + 200 },
        }));
        loadGraph([...nodes, ...offsetNodes], [...edges, ...newEdges], globalConfig);
      }

      toast.success(`Applied ${newNodes.length} components to canvas`);
      onOpenChange(false);
      setResult("");
      setPrompt("");
    } catch (err) {
      toast.error("Failed to parse YAML", {
        description: err instanceof Error ? err.message : "Invalid YAML output",
      });
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Pipeline Builder
          </DialogTitle>
          <DialogDescription>
            Describe what you want to build, or ask for a review of your current pipeline.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "generate" | "review")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="generate">Generate</TabsTrigger>
            <TabsTrigger value="review" disabled={nodes.length === 0}>
              Review
            </TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="ai-pipeline-prompt">Describe your pipeline</Label>
              <form onSubmit={handleSubmit} className="flex gap-2">
                <Input
                  id="ai-pipeline-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Collect K8s logs, drop debug, send to Datadog and S3"
                  disabled={isStreaming}
                />
                {isStreaming ? (
                  <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button type="submit" size="sm" disabled={!prompt.trim()}>
                    Generate
                  </Button>
                )}
              </form>
            </div>
          </TabsContent>

          <TabsContent value="review" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="ai-review-prompt">Ask about your pipeline</Label>
              <form onSubmit={handleSubmit} className="flex gap-2">
                <Input
                  id="ai-review-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Is my pipeline config optimal? Any issues?"
                  disabled={isStreaming}
                />
                {isStreaming ? (
                  <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button type="submit" size="sm" disabled={!prompt.trim()}>
                    Review
                  </Button>
                )}
              </form>
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {(result || isStreaming) && (
          <div className="space-y-3">
            <Label>Result</Label>
            <div className="relative rounded border bg-muted/50 p-3 font-mono text-sm whitespace-pre-wrap max-h-[300px] overflow-y-auto">
              {result || (
                <span className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {mode === "generate" ? "Generating pipeline..." : "Reviewing pipeline..."}
                </span>
              )}
            </div>
            {!isStreaming && result && (
              <div className="flex gap-2">
                {mode === "generate" && (
                  <Button size="sm" onClick={handleApplyToCanvas}>
                    Apply to Canvas
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => { setResult(""); handleSubmit(); }}>
                  <RotateCcw className="mr-1.5 h-3 w-3" />
                  Regenerate
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
