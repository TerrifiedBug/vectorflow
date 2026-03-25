"use client";

import { Eye, Rocket, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { timeAgo } from "@/lib/format-time-ago";

export interface VersionSummary {
  id: string;
  pipelineId: string;
  version: number;
  changelog: string | null;
  createdById: string | null;
  createdAt: Date | string;
  createdBy: { name: string | null; email: string | null } | null;
}

export interface SelectedVersions {
  a: string | null;
  b: string | null;
}

interface VersionTimelineProps {
  versions: VersionSummary[];
  currentVersionId: string | null;
  onView: (versionId: string) => void;
  onRollback: (versionId: string) => void;
  isRollbackPending?: boolean;
  /** Called when user clicks "Deploy this version" on a non-current version. */
  onDeploy?: (versionId: string) => void;
  /** When true, the deploy button is disabled (mutation in flight). */
  isDeployPending?: boolean;
  /** When true, show A/B selection indicators on each timeline item. */
  selectable?: boolean;
  /** Currently selected A (old) and B (new) version IDs. */
  selectedVersions?: SelectedVersions;
  /** Called when the user toggles an A or B selection. */
  onSelectionChange?: (selected: SelectedVersions) => void;
}

/** Derive display name from author: name → email prefix → 'System' */
function authorName(
  createdBy: { name: string | null; email: string | null } | null,
): string {
  if (createdBy?.name) return createdBy.name;
  if (createdBy?.email) return createdBy.email.split("@")[0];
  return "System";
}

/** Derive initials for avatar fallback */
function authorInitials(
  createdBy: { name: string | null; email: string | null } | null,
): string {
  const name = authorName(createdBy);
  if (name === "System") return "SY";
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Format a date to a full locale string for tooltip display */
function formatFullDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function VersionTimeline({
  versions,
  currentVersionId,
  onView,
  onRollback,
  isRollbackPending = false,
  onDeploy,
  isDeployPending = false,
  selectable = false,
  selectedVersions,
  onSelectionChange,
}: VersionTimelineProps) {
  /** Toggle an A or B selection for a version ID. Clicking the same again deselects. */
  const handleSelect = (slot: "a" | "b", versionId: string) => {
    if (!onSelectionChange || !selectedVersions) return;
    const current = selectedVersions[slot];
    const otherSlot = slot === "a" ? "b" : "a";
    // If the other slot has this version, swap them
    if (selectedVersions[otherSlot] === versionId) {
      onSelectionChange({
        ...selectedVersions,
        [otherSlot]: current,
        [slot]: versionId,
      });
      return;
    }
    onSelectionChange({
      ...selectedVersions,
      [slot]: current === versionId ? null : versionId,
    });
  };
  return (
    <TooltipProvider>
      <div className="relative pl-8">
        {/* Vertical timeline line */}
        <div className="absolute left-[13px] top-2 bottom-2 w-px bg-border" />

        <div className="space-y-0">
          {versions.map((version, index) => {
            const isCurrent = currentVersionId === version.id;
            const isFirst = index === 0;
            const isLast = index === versions.length - 1;

            return (
              <div key={version.id} className="relative group">
                {/* Timeline dot */}
                <div
                  className={
                    "absolute -left-[19px] top-5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 " +
                    (isCurrent
                      ? "border-green-500 bg-green-500"
                      : "border-border bg-background")
                  }
                >
                  {isCurrent && (
                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </div>

                {/* Content card */}
                <div
                  className={
                    "py-3 pr-2 rounded-lg transition-colors " +
                    (selectable ? "pl-[72px]" : "pl-4") +
                    (isCurrent
                      ? " bg-green-500/5"
                      : " hover:bg-muted/50") +
                    (isFirst ? "" : "") +
                    (isLast ? "" : " border-b border-border/40")
                  }
                >
                  {/* A/B selection buttons — shown when selectable is true */}
                  {selectable && (
                    <div
                      className={
                        "absolute left-6 top-3 flex flex-col gap-1 transition-opacity duration-200 " +
                        (selectable ? "opacity-100" : "opacity-0 pointer-events-none")
                      }
                    >
                      <button
                        type="button"
                        onClick={() => handleSelect("a", version.id)}
                        className={
                          "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold border-2 transition-colors " +
                          (selectedVersions?.a === version.id
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-border bg-background text-muted-foreground hover:border-blue-400 hover:text-blue-500")
                        }
                        title={`Select as version A (old)`}
                        aria-label={`Select v${version.version} as version A`}
                      >
                        A
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelect("b", version.id)}
                        className={
                          "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold border-2 transition-colors " +
                          (selectedVersions?.b === version.id
                            ? "border-orange-500 bg-orange-500 text-white"
                            : "border-border bg-background text-muted-foreground hover:border-orange-400 hover:text-orange-500")
                        }
                        title={`Select as version B (new)`}
                        aria-label={`Select v${version.version} as version B`}
                      >
                        B
                      </button>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    {/* Left: version info */}
                    <div className="flex-1 min-w-0">
                      {/* Version number + badge row */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-semibold">
                          v{version.version}
                        </span>
                        {isCurrent && (
                          <Badge
                            variant="secondary"
                            size="sm"
                            className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20"
                          >
                            Current
                          </Badge>
                        )}
                      </div>

                      {/* Changelog */}
                      {version.changelog ? (
                        <p className="text-sm text-foreground/80 mb-1.5 line-clamp-2">
                          {version.changelog}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground/60 mb-1.5 italic">
                          No changelog
                        </p>
                      )}

                      {/* Author + timestamp row */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Avatar size="sm">
                          <AvatarFallback className="text-[10px]">
                            {authorInitials(version.createdBy)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate max-w-[140px]">
                          {authorName(version.createdBy)}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="tabular-nums cursor-default">
                              {timeAgo(version.createdAt)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {formatFullDate(version.createdAt)}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    {/* Right: action buttons */}
                    <div className="flex items-center gap-1 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="View config"
                        aria-label={`View version ${version.version} config`}
                        onClick={() => onView(version.id)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {!isCurrent && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Rollback to this version"
                          aria-label={`Rollback to version ${version.version}`}
                          disabled={isRollbackPending}
                          onClick={() => onRollback(version.id)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                      {!isCurrent && onDeploy && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          title="Deploy this version"
                          aria-label={`Deploy version ${version.version}`}
                          disabled={isDeployPending}
                          onClick={() => onDeploy(version.id)}
                        >
                          <Rocket className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
