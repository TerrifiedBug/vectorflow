"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorContextLine {
  timestamp: string;
  message: string;
}

interface ErrorContextData {
  lines: ErrorContextLine[];
  truncated: boolean;
}

interface ErrorContextPanelProps {
  errorContext: ErrorContextData | null;
  pipelineId?: string | null;
  className?: string;
}

export function ErrorContextPanel({
  errorContext,
  pipelineId,
  className,
}: ErrorContextPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!errorContext || errorContext.lines.length === 0) return null;

  return (
    <div className={cn("rounded-md border border-destructive/20 bg-destructive/5 p-3", className)}>
      <button
        type="button"
        className="flex w-full items-center gap-2 text-sm font-medium text-destructive"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        Recent Errors ({errorContext.lines.length}
        {errorContext.truncated ? "+" : ""})
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-1.5">
          {errorContext.lines.map((line, i) => (
            <div key={i} className="rounded bg-destructive/10 px-2 py-1.5">
              <span className="text-[10px] text-muted-foreground">
                {new Date(line.timestamp).toLocaleString()}
              </span>
              <p className="mt-0.5 break-all font-mono text-xs text-destructive">
                {line.message}
              </p>
            </div>
          ))}
          {pipelineId && (
            <Button
              variant="link"
              size="sm"
              className="h-auto gap-1 p-0 text-xs"
              asChild
            >
              <a href={`/pipelines/${pipelineId}?logs=1`}>
                <ExternalLink className="h-3 w-3" />
                View full logs
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
