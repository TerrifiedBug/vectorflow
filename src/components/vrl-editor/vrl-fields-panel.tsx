"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
  MousePointerClick,
  Trash2,
  ArrowRightLeft,
  Braces,
  CaseLower,
  Clock,
  Hash,
  Layers,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { OutputFieldSchema } from "@/lib/vector/source-output-schemas";
/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface VrlFieldsPanelProps {
  staticFields: OutputFieldSchema[];
  liveFields: Array<{ path: string; type: string; sample: string }>;
  onInsert: (code: string) => void;
}

interface MergedField {
  path: string;
  type: string;
  description: string;
  sample: string;
  always: boolean;
  source: "static" | "live" | "both";
}

/* ------------------------------------------------------------------ */
/*  Type badge colors                                                  */
/* ------------------------------------------------------------------ */

const TYPE_COLORS: Record<string, string> = {
  string: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  integer: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  float: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  number: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  boolean: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  timestamp: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  object: "bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300",
  array: "bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300",
};

function typeBadgeClass(type: string): string {
  return TYPE_COLORS[type] ?? "bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300";
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Returns the top-level group for a field path.
 *  ".message" -> "Top-level", ".kubernetes.pod_name" -> ".kubernetes" */
function getGroupKey(path: string): string {
  // path always starts with "."
  const withoutLeadingDot = path.slice(1); // "kubernetes.pod_name"
  const dotIndex = withoutLeadingDot.indexOf(".");
  if (dotIndex === -1) return "Top-level";
  return "." + withoutLeadingDot.slice(0, dotIndex);
}

/** Returns the relative name within its group.
 *  For top-level: ".message" -> ".message"
 *  For nested: ".kubernetes.pod_name" in group ".kubernetes" -> ".pod_name" */
function getRelativeName(path: string, groupKey: string): string {
  if (groupKey === "Top-level") return path;
  return path.slice(groupKey.length); // ".kubernetes.pod_name" -> ".pod_name"
}

/** Merge static and live fields. */
function mergeFields(
  staticFields: VrlFieldsPanelProps["staticFields"],
  liveFields: VrlFieldsPanelProps["liveFields"],
): MergedField[] {
  const liveByPath = new Map(liveFields.map((f) => [f.path, f]));
  const merged: MergedField[] = [];

  // Static fields — enhanced by live data if available
  for (const sf of staticFields) {
    const live = liveByPath.get(sf.path);
    if (live) {
      liveByPath.delete(sf.path);
      merged.push({
        path: sf.path,
        type: live.type || sf.type,
        description: sf.description,
        sample: live.sample,
        always: sf.always,
        source: "both",
      });
    } else {
      merged.push({
        path: sf.path,
        type: sf.type,
        description: sf.description,
        sample: "",
        always: sf.always,
        source: "static",
      });
    }
  }

  // Live-only ("discovered") fields
  for (const [, lf] of liveByPath) {
    merged.push({
      path: lf.path,
      type: lf.type,
      description: "",
      sample: lf.sample,
      always: false,
      source: "live",
    });
  }

  return merged;
}

/** Check if a sample value looks like a timestamp string */
function looksLikeTimestamp(sample: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[T ]/.test(sample);
}

/** Check if a sample value looks like JSON */
function looksLikeJson(sample: string): boolean {
  const trimmed = sample.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/* ------------------------------------------------------------------ */
/*  Quick action definitions                                           */
/* ------------------------------------------------------------------ */

interface QuickAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  getCode: (path: string, renameTo?: string) => string;
  /** Return true if this action applies to the given field */
  applies: (field: MergedField) => boolean;
  /** If true, this action needs a rename input */
  needsRename?: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Insert field path",
    icon: MousePointerClick,
    getCode: (path) => path,
    applies: () => true,
  },
  {
    label: "Delete field",
    icon: Trash2,
    getCode: (path) => `del(${path})`,
    applies: () => true,
  },
  {
    label: "Rename field",
    icon: ArrowRightLeft,
    getCode: (path, renameTo) => `.${renameTo} = del(${path})`,
    applies: () => true,
    needsRename: true,
  },
  {
    label: "Parse JSON",
    icon: Braces,
    getCode: (path) => `. = merge!(., parse_json!(${path}))`,
    applies: (f) =>
      (f.type === "string" || f.type === "") && f.sample !== "" && looksLikeJson(f.sample),
  },
  {
    label: "Downcase",
    icon: CaseLower,
    getCode: (path) => `${path} = downcase(${path})`,
    applies: (f) => f.type === "string",
  },
  {
    label: "Format timestamp",
    icon: Clock,
    getCode: (path) =>
      `${path} = format_timestamp!(${path}, format: "%Y-%m-%d %H:%M:%S")`,
    applies: (f) => f.type === "timestamp",
  },
  {
    label: "Parse as timestamp",
    icon: Clock,
    getCode: (path) =>
      `${path} = parse_timestamp!(${path}, format: "%+")`,
    applies: (f) =>
      f.type === "string" && f.sample !== "" && looksLikeTimestamp(f.sample),
  },
  {
    label: "Round",
    icon: Hash,
    getCode: (path) => `${path} = round(${path})`,
    applies: (f) => f.type === "float",
  },
  {
    label: "To integer",
    icon: Hash,
    getCode: (path) => `${path} = to_int!(${path})`,
    applies: (f) => f.type === "float",
  },
  {
    label: "Flatten object",
    icon: Layers,
    getCode: (path) => `. = merge(., ${path})\ndel(${path})`,
    applies: (f) => f.type === "object",
  },
];

/* ------------------------------------------------------------------ */
/*  FieldRow                                                           */
/* ------------------------------------------------------------------ */

function FieldRow({
  field,
  groupKey,
  onInsert,
}: {
  field: MergedField;
  groupKey: string;
  onInsert: (code: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const relativeName = getRelativeName(field.path, groupKey);
  const applicableActions = QUICK_ACTIONS.filter((a) => a.applies(field));

  const handleRenameSubmit = useCallback(() => {
    if (renameValue.trim()) {
      const action = QUICK_ACTIONS.find((a) => a.needsRename);
      if (action) {
        onInsert(action.getCode(field.path, renameValue.trim()));
      }
    }
    setRenaming(null);
    setRenameValue("");
  }, [renameValue, field.path, onInsert]);

  return (
    <div className="group/row rounded px-3 py-1 hover:bg-accent">
      {/* Row 1: field name + type + sample */}
      <div className="flex items-center gap-1.5">
        <button
          className="shrink-0 font-mono text-xs font-medium hover:underline"
          onClick={() => onInsert(field.path)}
          title={field.path}
        >
          {relativeName}
        </button>

        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium leading-none ${typeBadgeClass(field.type)}`}
        >
          {field.type || "unknown"}
        </span>

        {field.source === "live" && (
          <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium leading-none text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
            discovered
          </span>
        )}

        {field.sample && (
          <span
            className="min-w-0 truncate text-xs text-muted-foreground"
            title={field.sample}
          >
            {field.sample}
          </span>
        )}
      </div>

      {/* Row 2: quick actions — appears on hover */}
      <div className="mt-0.5 flex flex-wrap items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
        {applicableActions.map((action) => {
          if (action.needsRename) {
            return (
              <Tooltip key={action.label}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    aria-label={action.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming(field.path);
                      setRenameValue("");
                    }}
                  >
                    <action.icon className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{action.label}</TooltipContent>
              </Tooltip>
            );
          }
          return (
            <Tooltip key={action.label}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  aria-label={action.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onInsert(action.getCode(field.path));
                  }}
                >
                  <action.icon className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{action.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Inline rename input */}
      {renaming === field.path && (
        <div className="mt-0.5 flex items-center gap-1">
          <Input
            autoFocus
            className="h-5 flex-1 px-1 text-xs font-mono"
            placeholder=".new_name ⏎"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") {
                setRenaming(null);
                setRenameValue("");
              }
            }}
            onBlur={() => {
              setRenaming(null);
              setRenameValue("");
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  VrlFieldsPanel                                                     */
/* ------------------------------------------------------------------ */

export function VrlFieldsPanel({
  staticFields,
  liveFields,
  onInsert,
}: VrlFieldsPanelProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const hasLiveFields = liveFields.length > 0;

  const merged = useMemo(
    () => mergeFields(staticFields, liveFields),
    [staticFields, liveFields],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return merged;
    const q = search.toLowerCase();
    return merged.filter(
      (f) =>
        f.path.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.sample.toLowerCase().includes(q),
    );
  }, [merged, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, MergedField[]>();
    for (const field of filtered) {
      const key = getGroupKey(field.path);
      const existing = map.get(key);
      if (existing) {
        existing.push(field);
      } else {
        map.set(key, [field]);
      }
    }
    return map;
  }, [filtered]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Empty state: no fields at all
  if (staticFields.length === 0 && liveFields.length === 0) {
    return (
      <div className="flex max-h-64 w-full flex-col overflow-hidden rounded border bg-muted/20">
        <p className="p-4 text-center text-xs text-muted-foreground">
          No fields available. Fetch samples to discover fields.
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-h-64 w-full flex-col overflow-hidden rounded border bg-muted/20">
      {/* Search input */}
      <div className="border-b p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter fields..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Field list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-1">
          {grouped.size === 0 && (
            <p className="p-3 text-center text-xs text-muted-foreground">
              No fields match filter
            </p>
          )}
          {Array.from(grouped.entries()).map(([groupKey, fields]) => (
            <div key={groupKey}>
              <button
                onClick={() => toggleGroup(groupKey)}
                aria-expanded={!collapsed.has(groupKey)}
                className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50"
              >
                {collapsed.has(groupKey) ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {groupKey}
                <span className="ml-auto text-xs font-normal">
                  {fields.length}
                </span>
              </button>
              {!collapsed.has(groupKey) &&
                fields.map((field) => (
                  <FieldRow
                    key={field.path}
                    field={field}
                    groupKey={groupKey}
                    onInsert={onInsert}
                  />
                ))}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Hint when only static fields are available */}
      {!hasLiveFields && staticFields.length > 0 && (
        <div className="border-t px-3 py-1.5">
          <p className="text-xs text-muted-foreground">
            Fetch samples for live field types and values
          </p>
        </div>
      )}
    </div>
  );
}
