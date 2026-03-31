"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, Sparkles, X, Check, Code } from "lucide-react";
import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { AiSuggestion } from "@/lib/ai/types";

interface SuggestedAction {
  type: "add_sampling" | "add_filter" | "remove_sink" | "disable_pipeline";
  config: Record<string, unknown>;
}

interface RecommendationBannerProps {
  title: string;
  aiSummary: string | null;
  description: string;
  suggestedAction: SuggestedAction | null;
  aiSuggestions?: AiSuggestion[];
  onApplySuggestion?: (suggestion: AiSuggestion) => void;
}

const ACTION_INSTRUCTIONS: Record<string, string> = {
  add_sampling:
    "Drag a 'sample' transform from the palette and connect it between your source and sink nodes. Set the sample rate in the configuration panel.",
  add_filter:
    "Drag a 'filter' transform from the palette and connect it after your source. Configure the filter condition to drop unwanted events.",
  remove_sink:
    "Select the duplicate sink node highlighted below and delete it. Verify that remaining sinks cover the intended destinations.",
  disable_pipeline:
    "This pipeline appears stale. If it is no longer needed, undeploy it from the Deploy menu to free agent resources.",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

const TYPE_LABELS: Record<string, string> = {
  modify_vrl: "VRL Change",
  modify_config: "Config Change",
  add_component: "Add Component",
  remove_component: "Remove Component",
  modify_connections: "Rewire",
};

function SuggestionItem({
  suggestion,
  onApply,
}: {
  suggestion: AiSuggestion;
  onApply?: (suggestion: AiSuggestion) => void;
}) {
  const [applied, setApplied] = useState(false);

  const handleApply = useCallback(() => {
    onApply?.(suggestion);
    setApplied(true);
  }, [onApply, suggestion]);

  return (
    <div className={cn("rounded-md border bg-background p-3", applied && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-medium", applied && "line-through")}>
              {suggestion.title}
            </span>
            <Badge
              variant="outline"
              className={cn("text-[10px]", PRIORITY_COLORS[suggestion.priority])}
            >
              {suggestion.priority}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {TYPE_LABELS[suggestion.type] ?? suggestion.type}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{suggestion.description}</p>
          {"code" in suggestion && suggestion.code && (
            <div className="mt-2 flex items-start gap-1.5">
              <Code className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <pre className="max-h-24 overflow-auto rounded bg-muted/50 px-2 py-1 text-xs">
                {suggestion.code}
              </pre>
            </div>
          )}
        </div>
        {onApply && !applied && (
          <Button size="sm" variant="outline" className="shrink-0 gap-1" onClick={handleApply}>
            <Check className="h-3 w-3" />
            Apply
          </Button>
        )}
        {applied && (
          <Badge
            variant="secondary"
            className="shrink-0 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          >
            Applied
          </Badge>
        )}
      </div>
    </div>
  );
}

export function RecommendationBanner({
  title,
  aiSummary,
  description,
  suggestedAction,
  aiSuggestions,
  onApplySuggestion,
}: RecommendationBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const hasSuggestions = aiSuggestions && aiSuggestions.length > 0;

  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{title}</p>
            {aiSummary ? (
              <div className="mt-1 flex items-start gap-1.5">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
                <p className="text-sm text-muted-foreground">{aiSummary}</p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => setDismissed(true)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {hasSuggestions ? (
          <div className="flex flex-col gap-2 pl-8">
            {aiSuggestions.map((s) => (
              <SuggestionItem key={s.id} suggestion={s} onApply={onApplySuggestion} />
            ))}
          </div>
        ) : (
          suggestedAction && ACTION_INSTRUCTIONS[suggestedAction.type] && (
            <p className="pl-8 text-xs text-muted-foreground/80">
              {ACTION_INSTRUCTIONS[suggestedAction.type]}
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
