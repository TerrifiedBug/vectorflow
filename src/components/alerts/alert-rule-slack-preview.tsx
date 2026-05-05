"use client";

import * as React from "react";
import { VFIcon } from "@/components/ui/vf-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AlertRuleSlackPreviewProps {
  name: string;
  severity: "info" | "warning" | "critical" | string;
  metric: string;
  condition: string;
  threshold: string;
  durationSeconds: number;
  pipelineName: string | null;
}

const CONDITION_OP: Record<string, string> = {
  gt: ">",
  lt: "<",
  eq: "=",
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-l-status-error",
  warning: "border-l-status-degraded",
  info: "border-l-status-info",
};

const SEVERITY_TEXT: Record<string, string> = {
  critical: "text-status-error",
  warning: "text-status-degraded",
  info: "text-status-info",
};

/**
 * Static Slack notification preview. Renders an example notification card
 * styled to mirror Slack's alert layout, driven by the form's current state.
 */
export function AlertRuleSlackPreview({
  name,
  severity,
  metric,
  condition,
  threshold,
  durationSeconds,
  pipelineName,
}: AlertRuleSlackPreviewProps) {
  const op = CONDITION_OP[condition] ?? condition;
  const thresholdLabel = threshold.trim() === "" ? "0" : threshold;
  const scopeLabel = pipelineName && pipelineName.trim() !== "" ? pipelineName : "any pipeline";
  const durationLabel = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? `${durationSeconds}s`
    : "0s";
  const ruleName = name.trim() === "" ? "(unnamed rule)" : name;
  const sevKey = severity in SEVERITY_BORDER ? severity : "critical";
  const borderClass = SEVERITY_BORDER[sevKey];
  const sevTextClass = SEVERITY_TEXT[sevKey];

  return (
    <div className="mt-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
        Preview · notification sample
      </div>
      <div
        className={cn(
          "mt-2 rounded-md border border-line-2 border-l-[3px] bg-bg-2 p-4",
          borderClass,
        )}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-[3px] bg-bg-1 text-fg-1">
            <VFIcon name="bell" size={12} />
          </span>
          <span className="font-mono text-[12px] font-medium text-fg">VectorFlow Alerts</span>
          <span className="rounded-[3px] bg-bg-1 px-1.5 py-0.5 font-mono text-[10px] text-fg-2">
            APP
          </span>
          <span className="ml-auto font-mono text-[10.5px] text-fg-2">now</span>
        </div>
        <div className={cn("mt-2 font-mono text-[13px] font-medium", sevTextClass)}>
          {ruleName}
        </div>
        <div className="mt-1 font-mono text-[11.5px] text-fg-1">
          {metric} {op} {thresholdLabel} for {durationLabel} on {scopeLabel}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="ghost" size="sm" className="h-7 px-2.5 text-[11px]" disabled>
            Acknowledge
          </Button>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-[11px]" disabled>
            View in VectorFlow
          </Button>
        </div>
      </div>
    </div>
  );
}
