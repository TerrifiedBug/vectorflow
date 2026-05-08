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
  modify_config: "CONFIG",
  modify_vrl: "VRL",
  add_component: "ADD NODE",
  remove_component: "REMOVE",
  modify_connections: "REWIRE",
};

const PRIORITY_COLORS: Record<AiSuggestion["priority"], string> = {
  high: "border-[color:var(--status-error)]/40 bg-[color:var(--status-error-bg)] text-status-error",
  medium: "border-[color:var(--status-degraded)]/40 bg-[color:var(--status-degraded-bg)] text-status-degraded",
  low: "border-[color:var(--status-healthy)]/40 bg-[color:var(--status-healthy-bg)] text-status-healthy",
};

const STATUS_BADGES: Partial<Record<SuggestionStatus, { label: string; className: string }>> = {
  applied: { label: "APPLIED", className: "border-[color:var(--status-healthy)]/40 bg-[color:var(--status-healthy-bg)] text-status-healthy" },
  outdated: { label: "OUTDATED", className: "border-[color:var(--status-degraded)]/40 bg-[color:var(--status-degraded-bg)] text-status-degraded" },
  invalid: { label: "INVALID", className: "border-[color:var(--status-error)]/40 bg-[color:var(--status-error-bg)] text-status-error" },
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
        "rounded-[3px] border border-line-2 bg-bg-2 p-2.5 transition-colors",
        isSelected && !isDisabled && "border-accent-line bg-accent-soft",
        hasConflict && "border-[color:var(--status-degraded)]/50",
        isDisabled && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={isSelected}
          disabled={isDisabled}
          onCheckedChange={() => onToggle(suggestion.id)}
          className="mt-0.5 rounded-[3px] border-line-2"
        />

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "font-mono text-[12px] font-medium text-fg",
                status === "applied" && "line-through text-fg-2",
              )}
            >
              {suggestion.title}
            </span>

            {statusBadge && (
              <Badge variant="outline" size="sm" className={cn("font-mono text-[9.5px] uppercase tracking-[0.06em]", statusBadge.className)}>
                {statusBadge.label}
              </Badge>
            )}

            <Badge variant="outline" size="sm" className={cn("font-mono text-[9.5px] uppercase tracking-[0.06em]", PRIORITY_COLORS[suggestion.priority])}>
              {suggestion.priority}
            </Badge>

            <Badge variant="outline" size="sm" className="border-line bg-bg font-mono text-[9.5px] uppercase tracking-[0.06em] text-fg-2">
              {TYPE_LABELS[suggestion.type]}
            </Badge>

            {applyResult != null ? (
              applyResult.success ? (
                <Badge variant="outline" size="sm" className="gap-0.5 border-[color:var(--status-healthy)]/40 bg-[color:var(--status-healthy-bg)] font-mono text-[9.5px] uppercase tracking-[0.06em] text-status-healthy">
                  <Check className="h-2.5 w-2.5" />
                  Applied
                </Badge>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" size="sm" className="gap-0.5 border-[color:var(--status-error)]/40 bg-[color:var(--status-error-bg)] font-mono text-[9.5px] uppercase tracking-[0.06em] text-status-error">
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

          <p className="mt-1 font-mono text-[11px] leading-5 text-fg-2">
            {renderDescription(suggestion)}
          </p>

          {suggestion.type === "modify_config" && (
            diff ? (
              <SuggestionDiffPreview diff={diff} />
            ) : (
              <div className="mt-2 rounded-[3px] border border-line bg-bg px-2 py-1 font-mono text-[11px]">
                {Object.entries(suggestion.changes).map(([key, value]) => (
                  <div key={key}>
                    <span className="text-fg-2">{key}:</span>{" "}
                    <span className="text-fg">{JSON.stringify(value)}</span>
                  </div>
                ))}
              </div>
            )
          )}

          {suggestion.type === "modify_vrl" && (
            diff ? (
              <SuggestionDiffPreview diff={diff} />
            ) : (
              <div className="mt-2 space-y-1 rounded-[3px] border border-line bg-bg px-2 py-1.5 font-mono text-[11px]">
                <div className="whitespace-pre-wrap text-status-error line-through">
                  {suggestion.targetCode}
                </div>
                <div className="whitespace-pre-wrap text-status-healthy">
                  {suggestion.code}
                </div>
              </div>
            )
          )}

          {hasConflict && conflictReason && (
            <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-status-degraded">
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
      <code key={i} className="rounded-[3px] bg-bg px-1 font-mono text-fg">
        {part}
      </code>
    ) : (
      part
    ),
  );
}
