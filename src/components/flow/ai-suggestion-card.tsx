"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AiSuggestion, SuggestionStatus } from "@/lib/ai/types";
import type { DiffResult } from "@/lib/ai/suggestion-diff";
import { AlertTriangle, Check, X } from "lucide-react";
import { SuggestionDiffPreview } from "./suggestion-diff-preview";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AiSuggestionCardProps {
  suggestion: AiSuggestion;
  status: SuggestionStatus;
  isSelected: boolean;
  hasConflict: boolean;
  conflictReason?: string;
  onToggle: (id: string) => void;
  diff?: DiffResult | null;
  applyResult?: { success: boolean; error?: string } | null;
}

const TYPE_LABELS: Record<AiSuggestion["type"], string> = {
  modify_config: "Config Change",
  modify_vrl: "VRL Fix",
  add_component: "Add Component",
  remove_component: "Remove Component",
  modify_connections: "Rewire",
};

const PRIORITY_COLORS: Record<AiSuggestion["priority"], string> = {
  high: "bg-red-500/15 text-red-700 dark:text-red-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-green-500/15 text-green-700 dark:text-green-400",
};

const STATUS_BADGES: Partial<Record<SuggestionStatus, { label: string; className: string }>> = {
  applied: { label: "Applied", className: "bg-green-500/15 text-green-700 dark:text-green-400" },
  outdated: { label: "Outdated", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  invalid: { label: "Invalid", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
};

export function AiSuggestionCard({
  suggestion,
  status,
  isSelected,
  hasConflict,
  conflictReason,
  onToggle,
  diff,
  applyResult,
}: AiSuggestionCardProps) {
  const isDisabled = status === "applied" || status === "invalid";
  const statusBadge = STATUS_BADGES[status];

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        isSelected && !isDisabled && "border-primary/50 bg-primary/5",
        hasConflict && "border-amber-500/50",
        isDisabled && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isSelected}
          disabled={isDisabled}
          onCheckedChange={() => onToggle(suggestion.id)}
          className="mt-0.5"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "font-medium text-sm",
                status === "applied" && "line-through text-muted-foreground",
              )}
            >
              {suggestion.title}
            </span>

            {statusBadge && (
              <Badge variant="outline" size="sm" className={statusBadge.className}>
                {statusBadge.label}
              </Badge>
            )}

            <Badge variant="outline" size="sm" className={PRIORITY_COLORS[suggestion.priority]}>
              {suggestion.priority}
            </Badge>

            <Badge variant="secondary" size="sm">
              {TYPE_LABELS[suggestion.type]}
            </Badge>

            {applyResult != null ? (
              applyResult.success ? (
                <Badge variant="outline" size="sm" className="bg-green-500/15 text-green-700 dark:text-green-400 gap-0.5">
                  <Check className="h-2.5 w-2.5" />
                  Applied
                </Badge>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" size="sm" className="bg-red-500/15 text-red-700 dark:text-red-400 gap-0.5">
                      <X className="h-2.5 w-2.5" />
                      Failed
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {applyResult.error ?? "Unknown error"}
                  </TooltipContent>
                </Tooltip>
              )
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground mt-1">
            {renderDescription(suggestion)}
          </p>

          {suggestion.type === "modify_config" && (
            diff ? (
              <SuggestionDiffPreview diff={diff} />
            ) : (
              <div className="mt-2 text-xs font-mono bg-muted rounded px-2 py-1">
                {Object.entries(suggestion.changes).map(([key, value]) => (
                  <div key={key}>
                    <span className="text-muted-foreground">{key}:</span>{" "}
                    <span className="text-foreground">{JSON.stringify(value)}</span>
                  </div>
                ))}
              </div>
            )
          )}

          {suggestion.type === "modify_vrl" && (
            diff ? (
              <SuggestionDiffPreview diff={diff} />
            ) : (
              <div className="mt-2 text-xs font-mono bg-muted rounded px-2 py-1.5 space-y-1">
                <div className="text-red-600 dark:text-red-400 line-through whitespace-pre-wrap">
                  {suggestion.targetCode}
                </div>
                <div className="text-green-600 dark:text-green-400 whitespace-pre-wrap">
                  {suggestion.code}
                </div>
              </div>
            )
          )}

          {hasConflict && conflictReason && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>{conflictReason}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderDescription(suggestion: AiSuggestion): React.ReactNode {
  const desc = suggestion.description;

  // Highlight componentKey references in the description
  const componentKeys: string[] = [];
  if (suggestion.type === "modify_config" || suggestion.type === "remove_component") {
    componentKeys.push(suggestion.componentKey);
  }
  if (suggestion.type === "add_component") {
    componentKeys.push(suggestion.insertAfter, ...suggestion.connectTo);
  }
  if (suggestion.type === "modify_connections") {
    for (const e of suggestion.edgeChanges) {
      componentKeys.push(e.from, e.to);
    }
  }
  if (suggestion.type === "modify_vrl") {
    componentKeys.push(suggestion.componentKey);
  }

  if (componentKeys.length === 0) return desc;

  const uniqueKeys = [...new Set(componentKeys)];
  const pattern = new RegExp(`(${uniqueKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const parts = desc.split(pattern);

  return parts.map((part, i) =>
    uniqueKeys.includes(part) ? (
      <code key={i} className="bg-muted px-1 rounded text-foreground">
        {part}
      </code>
    ) : (
      part
    ),
  );
}
