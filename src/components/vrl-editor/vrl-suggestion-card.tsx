"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VrlSuggestion, VrlSuggestionStatus } from "@/lib/ai/vrl-suggestion-types";

interface VrlSuggestionCardProps {
  suggestion: VrlSuggestion;
  status: VrlSuggestionStatus;
  isSelected: boolean;
  onToggle: (id: string) => void;
}

const TYPE_LABELS: Record<VrlSuggestion["type"], string> = {
  insert_code: "Insert",
  replace_code: "Replace",
  remove_code: "Remove",
};

const TYPE_COLORS: Record<VrlSuggestion["type"], string> = {
  insert_code: "bg-green-500/15 text-green-700 dark:text-green-400",
  replace_code: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  remove_code: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const PRIORITY_COLORS: Record<VrlSuggestion["priority"], string> = {
  high: "bg-red-500/15 text-red-700 dark:text-red-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-green-500/15 text-green-700 dark:text-green-400",
};

const STATUS_BADGES: Partial<
  Record<VrlSuggestionStatus, { label: string; className: string }>
> = {
  applied: {
    label: "Applied",
    className: "bg-green-500/15 text-green-700 dark:text-green-400",
  },
  outdated: {
    label: "Outdated",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
};

export function VrlSuggestionCard({
  suggestion,
  status,
  isSelected,
  onToggle,
}: VrlSuggestionCardProps) {
  const isDisabled = status === "applied" || status === "outdated";
  const statusBadge = STATUS_BADGES[status];

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        isSelected && !isDisabled && "border-primary/50 bg-primary/5",
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
                status === "applied" &&
                  "line-through text-muted-foreground",
              )}
            >
              {suggestion.title}
            </span>

            {statusBadge && (
              <Badge
                variant="outline"
                size="sm"
                className={statusBadge.className}
              >
                {statusBadge.label}
              </Badge>
            )}

            <Badge
              variant="outline"
              size="sm"
              className={PRIORITY_COLORS[suggestion.priority]}
            >
              {suggestion.priority}
            </Badge>

            <Badge
              variant="outline"
              size="sm"
              className={TYPE_COLORS[suggestion.type]}
            >
              {TYPE_LABELS[suggestion.type]}
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground mt-1">
            {suggestion.description}
          </p>

          {suggestion.code && (
            <pre className="mt-2 text-xs font-mono bg-muted rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap">
              {suggestion.code}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
