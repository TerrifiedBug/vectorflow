"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lightbulb, Sparkles, X } from "lucide-react";
import { useState } from "react";

interface SuggestedAction {
  type: "add_sampling" | "add_filter" | "remove_sink" | "disable_pipeline";
  config: Record<string, unknown>;
}

interface RecommendationBannerProps {
  title: string;
  aiSummary: string | null;
  description: string;
  suggestedAction: SuggestedAction | null;
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

export function RecommendationBanner({
  title,
  aiSummary,
  description,
  suggestedAction,
}: RecommendationBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
      <CardContent className="flex items-start gap-3 p-4">
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
          {suggestedAction && ACTION_INSTRUCTIONS[suggestedAction.type] && (
            <p className="mt-2 text-xs text-muted-foreground/80">
              {ACTION_INSTRUCTIONS[suggestedAction.type]}
            </p>
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
      </CardContent>
    </Card>
  );
}
