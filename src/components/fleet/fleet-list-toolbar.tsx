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
import { Label } from "@/components/ui/label";

const STATUS_OPTIONS = [
  { id: "HEALTHY", label: "Healthy" },
  { id: "DEGRADED", label: "Degraded" },
  { id: "UNREACHABLE", label: "Unreachable" },
  { id: "UNKNOWN", label: "Unknown" },
] as const;

export interface FleetListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string[];
  onStatusFilterChange: (statuses: string[]) => void;
  labelFilter: Record<string, string>;
  onLabelFilterChange: (labels: Record<string, string>) => void;
  /** Available labels: { key: [value1, value2, ...] } */
  availableLabels: Record<string, string[]>;
}

export function FleetListToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  labelFilter,
  onLabelFilterChange,
  availableLabels,
}: FleetListToolbarProps) {
  // Debounced search
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

  const labelKeys = Object.keys(availableLabels).sort();
  const activeLabelCount = Object.keys(labelFilter).length;

  const hasActiveFilters =
    search.length > 0 || statusFilter.length > 0 || activeLabelCount > 0;

  const clearAll = () => {
    onSearchChange("");
    setLocalSearch("");
    onStatusFilterChange([]);
    onLabelFilterChange({});
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
      {/* Search */}
      <div className="relative w-64">
        <Label htmlFor="fleet-search" className="sr-only">Search by name or host</Label>
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="fleet-search"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search by name or host..."
          className="h-8 pl-8 text-sm"
        />
      </div>

      <div className="h-6 w-px bg-border" />

      {/* Status filter chips */}
      <div className="flex items-center gap-1" role="group" aria-label="Fleet status filters">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            aria-pressed={statusFilter.includes(opt.id)}
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

      {/* Label filter */}
      {labelKeys.length > 0 && (
        <>
          <div className="h-6 w-px bg-border" />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1">
                Labels
                {activeLabelCount > 0 ? (
                  <Badge variant="secondary" className="ml-1 px-1 text-xs">
                    {activeLabelCount}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground ml-1">All</span>
                )}
                <ChevronsUpDown className="h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[260px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search labels..." />
                <CommandList>
                  <CommandEmpty>No labels found.</CommandEmpty>
                  {labelKeys.map((key) => (
                    <CommandGroup key={key} heading={key}>
                      {availableLabels[key].map((value) => {
                        const isActive = labelFilter[key] === value;
                        return (
                          <CommandItem
                            key={`${key}=${value}`}
                            onSelect={() => {
                              const next = { ...labelFilter };
                              if (isActive) {
                                delete next[key];
                              } else {
                                next[key] = value;
                              }
                              onLabelFilterChange(next);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                isActive ? "opacity-100" : "opacity-0",
                              )}
                            />
                            {value}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
              {activeLabelCount > 0 && (
                <div className="border-t p-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => onLabelFilterChange({})}
                  >
                    <X className="mr-1 h-3 w-3" />
                    Clear labels
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </>
      )}

      {/* Clear all */}
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
