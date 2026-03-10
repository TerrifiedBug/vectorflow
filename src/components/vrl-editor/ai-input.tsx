// src/components/vrl-editor/ai-input.tsx
"use client";

import { useState, useRef, useCallback } from "react";
import { Loader2, RotateCcw, Plus, Replace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTeamStore } from "@/stores/team-store";

interface AiInputProps {
  currentCode: string;
  fields?: { name: string; type: string }[];
  componentType?: string;
  sourceTypes?: string[];
  onInsert: (code: string) => void;
  onReplace: (code: string) => void;
}

export function AiInput({
  currentCode,
  fields,
  componentType,
  sourceTypes,
  onInsert,
  onReplace,
}: AiInputProps) {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!prompt.trim() || !selectedTeamId || isStreaming) return;

      setIsStreaming(true);
      setResult("");
      setError(null);

      abortRef.current = new AbortController();

      try {
        const response = await fetch("/api/ai/vrl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: selectedTeamId,
            prompt: prompt.trim(),
            currentCode,
            fields,
            componentType,
            sourceTypes,
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
    [prompt, selectedTeamId, currentCode, fields, componentType, sourceTypes, isStreaming],
  );

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleRegenerate = () => {
    setResult("");
    handleSubmit();
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want the VRL to do..."
          disabled={isStreaming}
          className="text-sm"
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

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {(result || isStreaming) && (
        <div className="space-y-2">
          <div className="relative rounded border bg-muted/50 p-3 font-mono text-sm whitespace-pre-wrap max-h-[200px] overflow-y-auto">
            {result || (
              <span className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Generating...
              </span>
            )}
          </div>
          {!isStreaming && result && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onInsert(result)}
              >
                <Plus className="mr-1.5 h-3 w-3" />
                Insert
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onReplace(result)}
              >
                <Replace className="mr-1.5 h-3 w-3" />
                Replace
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRegenerate}
              >
                <RotateCcw className="mr-1.5 h-3 w-3" />
                Regenerate
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
