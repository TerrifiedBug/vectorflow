// src/components/deploy-progress.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FadeIn } from "@/components/motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
  useDeployProgressStore,
  type DeployPipelineResult,
} from "@/stores/deploy-progress-store";

// ─── Status icon helper ────────────────────────────────────────────────────

function StatusIcon({ status }: { status: DeployPipelineResult["status"] }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    default:
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />;
  }
}

// ─── Component ─────────────────────────────────────────────────────────────

export function DeployProgressPanel() {
  const { total, completed, failed, results, isActive, dismiss } =
    useDeployProgressStore();
  const [expanded, setExpanded] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  if (total === 0) return null;

  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const succeeded = completed - failed;

  const expandedContent = (
    <div className="mt-2 max-h-48 space-y-1 overflow-y-auto border-t pt-2">
      {results.map((r) => (
        <div
          key={r.pipelineId}
          className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50"
        >
          <StatusIcon status={r.status} />
          <Link
            href={`/pipelines/${r.pipelineId}`}
            className="truncate hover:underline"
          >
            {r.pipelineName}
          </Link>
          {r.error && (
            <span className="ml-auto text-xs text-destructive truncate max-w-[140px]" title={r.error}>
              {r.error}
            </span>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <FadeIn>
      <div className="w-[360px] rounded-lg border bg-card p-4 shadow-lg">
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isActive ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : failed > 0 ? (
              <XCircle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
            <span className="text-sm font-medium">
              {isActive
                ? `Deploying... ${completed}/${total}`
                : `Deploy complete: ${succeeded}/${total} succeeded`}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={dismiss}
            aria-label="Dismiss deploy progress"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>

        {/* ── Progress bar ── */}
        <Progress value={progressPercent} className="mb-2 h-2" />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            {succeeded} succeeded{failed > 0 ? `, ${failed} failed` : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? (
              <>
                Hide details <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                Show details <ChevronDown className="h-3 w-3" />
              </>
            )}
          </Button>
        </div>

        {/* ── Expanded per-pipeline status ── */}
        {shouldReduceMotion ? (
          expanded && expandedContent
        ) : (
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                {expandedContent}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </FadeIn>
  );
}
