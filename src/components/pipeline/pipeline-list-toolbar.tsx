"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Check, ChevronsUpDown, X, LayoutList, List } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

// --- Types ---

export type SortField = "name" | "status" | "throughput" | "updated";
export type SortDirection = "asc" | "desc";

interface FilterOption {
  id: string;
  name: string;
}

export type Density = "comfortable" | "compact";

export interface PipelineListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string[];
  onStatusFilterChange: (statuses: string[]) => void;
  tagFilter: string[];
  onTagFilterChange: (tags: string[]) => void;
  availableTags: string[];
  /** Optional preset bar slot — rendered below filters when provided */
  presetBar?: React.ReactNode;
  /** Row density preference */
  density?: Density;
  onDensityChange?: (density: Density) => void;
  /** Count of pipelines per status for badge display */
  statusCounts?: Record<string, number>;
}

// --- Status chips ---

const STATUS_OPTIONS = [
  { id: "Running", label: "Running" },
  { id: "Stopped", label: "Stopped" },
  { id: "Crashed", label: "Crashed" },
  { id: "Draft", label: "Draft" },
] as const;

// --- Tag MultiSelect (replicated from metrics-filter-bar.tsx) ---

function TagMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: FilterOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 rounded-[3px] border-line-2 bg-bg-2 px-2.5 font-mono text-[10.5px] uppercase tracking-[0.05em]">
          Tags
          {selected.length > 0 ? (
            <Badge variant="secondary" className="ml-1 rounded-[3px] px-1 font-mono text-[9.5px]">
              {selected.length}
            </Badge>
          ) : (
            <span className="ml-1 text-fg-2">All</span>
          )}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] rounded-[3px] border-line-2 bg-bg-2 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search tags..." />
          <CommandList>
            <CommandEmpty>No tags found.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem key={opt.id} onSelect={() => toggle(opt.id)}>
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selected.includes(opt.id) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {opt.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="border-t border-line p-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full rounded-[3px] font-mono text-[10.5px] uppercase tracking-[0.05em]"
              onClick={() => onChange([])}
            >
              <X className="mr-1 h-3 w-3" />
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// --- Main toolbar ---

export function PipelineListToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  tagFilter,
  onTagFilterChange,
  availableTags,
  presetBar,
  density,
  onDensityChange,
  statusCounts,
}: PipelineListToolbarProps) {
  // Debounced search — local input state + 300ms debounce to parent
  const [localSearch, setLocalSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchChange(localSearch);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localSearch, onSearchChange]);

  // Sync external search changes back to local (e.g., clear-filters)
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  const toggleStatus = (status: string) => {
    onStatusFilterChange(
      statusFilter.includes(status)
        ? statusFilter.filter((s) => s !== status)
        : [...statusFilter, status],
    );
  };

  const tagOptions: FilterOption[] = availableTags.map((t) => ({
    id: t,
    name: t,
  }));

  const hasActiveFilters =
    search.length > 0 || statusFilter.length > 0 || tagFilter.length > 0;

  const clearAll = () => {
    onSearchChange("");
    setLocalSearch("");
    onStatusFilterChange([]);
    onTagFilterChange([]);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[3px] border border-line bg-bg-2 px-3 py-2.5">
      <div className="relative w-full min-w-[240px] flex-1 md:max-w-[320px]">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-2" />
        <Input
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search pipelines…"
          className="h-8 border-line-2 bg-bg-1 pl-8 font-mono text-[12px]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_OPTIONS.map((opt) => {
          const count = statusCounts?.[opt.id];
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggleStatus(opt.id)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-[3px] border px-2 font-mono text-[10.5px] uppercase tracking-[0.05em] transition-colors",
                statusFilter.includes(opt.id)
                  ? "border-accent-line bg-accent-soft text-accent-brand"
                  : "border-line bg-bg-1 text-fg-2 hover:border-line-2 hover:text-fg",
              )}
            >
              <span>{opt.label}</span>
              {count != null && (
                <span className={cn("min-w-[16px] text-right tabular-nums", statusFilter.includes(opt.id) ? "text-accent-brand" : "text-fg-2")}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tagOptions.length > 0 && (
        <TagMultiSelect
          options={tagOptions}
          selected={tagFilter}
          onChange={onTagFilterChange}
        />
      )}

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.05em] text-fg-2"
          onClick={clearAll}
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}

      {density && onDensityChange && (
        <div className="flex items-center rounded-[3px] border border-line bg-bg-1">
          <Button
            variant={density === "comfortable" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 rounded-none border-0 px-2 data-[variant=secondary]:bg-bg-3"
            onClick={() => onDensityChange("comfortable")}
          >
            <LayoutList className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={density === "compact" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 rounded-none border-0 border-l border-line px-2 data-[variant=secondary]:bg-bg-3"
            onClick={() => onDensityChange("compact")}
          >
            <List className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {presetBar && (
        <div className="min-w-full md:ml-auto md:min-w-[280px] md:flex-1">
          {presetBar}
        </div>
      )}
    </div>
  );
}
