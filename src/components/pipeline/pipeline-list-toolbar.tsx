"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Check, ChevronsUpDown, X } from "lucide-react";
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

export interface PipelineListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string[];
  onStatusFilterChange: (statuses: string[]) => void;
  tagFilter: string[];
  onTagFilterChange: (tags: string[]) => void;
  availableTags: string[];
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
        <Button variant="outline" size="sm" className="h-8 gap-1">
          Tags
          {selected.length > 0 ? (
            <Badge variant="secondary" className="ml-1 px-1 text-xs">
              {selected.length}
            </Badge>
          ) : (
            <span className="text-muted-foreground ml-1">All</span>
          )}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
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
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
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
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
      {/* Search */}
      <div className="relative w-64">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search pipelines..."
          className="h-8 pl-8 text-sm"
        />
      </div>

      {/* Separator */}
      <div className="h-6 w-px bg-border" />

      {/* Status filter chips */}
      <div className="flex items-center gap-1">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => toggleStatus(opt.id)}
            className={cn(
              "rounded-full px-3 h-7 text-xs font-medium border transition-colors",
              statusFilter.includes(opt.id)
                ? "bg-accent text-accent-foreground border-transparent"
                : "bg-transparent text-muted-foreground border-border hover:bg-muted",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Separator */}
      <div className="h-6 w-px bg-border" />

      {/* Tag multi-select */}
      {tagOptions.length > 0 && (
        <TagMultiSelect
          options={tagOptions}
          selected={tagFilter}
          onChange={onTagFilterChange}
        />
      )}

      {/* Clear all filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={clearAll}
        >
          <X className="mr-1 h-3 w-3" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
