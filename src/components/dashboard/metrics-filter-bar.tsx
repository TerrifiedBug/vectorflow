"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
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

export type TimeRange = "1h" | "6h" | "1d" | "7d";
export type GroupBy = "pipeline" | "node" | "aggregate";

interface FilterOption {
  id: string;
  name: string;
}

interface MetricsFilterBarProps {
  nodes: FilterOption[];
  pipelines: FilterOption[];
  selectedNodeIds: string[];
  selectedPipelineIds: string[];
  timeRange: TimeRange;
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  onNodeChange: (ids: string[]) => void;
  onPipelineChange: (ids: string[]) => void;
  onTimeRangeChange: (range: TimeRange) => void;
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id]
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1">
          {label}
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
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem key={opt.id} onSelect={() => toggle(opt.id)}>
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selected.includes(opt.id) ? "opacity-100" : "opacity-0"
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

export function MetricsFilterBar({
  nodes,
  pipelines,
  selectedNodeIds,
  selectedPipelineIds,
  timeRange,
  groupBy,
  onGroupByChange,
  onNodeChange,
  onPipelineChange,
  onTimeRangeChange,
}: MetricsFilterBarProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-2 sticky top-0 z-[5]">
      <div className="flex items-center gap-2">
        <MultiSelect
          label="Node"
          options={nodes}
          selected={selectedNodeIds}
          onChange={onNodeChange}
        />
        <MultiSelect
          label="Pipeline"
          options={pipelines}
          selected={selectedPipelineIds}
          onChange={onPipelineChange}
        />
        <div className="flex items-center gap-2 ml-2 pl-2 border-l">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Group by</span>
          <div className="flex items-center gap-1">
            {(["pipeline", "node", "aggregate"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onGroupByChange(v)}
                className={cn(
                  "rounded-full px-3 h-7 text-xs font-medium border transition-colors",
                  groupBy === v
                    ? "bg-accent text-accent-foreground border-transparent"
                    : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {(["1h", "6h", "1d", "7d"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onTimeRangeChange(v)}
            className={cn(
              "rounded-full px-3 h-7 text-xs font-medium border transition-colors",
              timeRange === v
                ? "bg-accent text-accent-foreground border-transparent"
                : "bg-transparent text-muted-foreground border-border hover:bg-muted"
            )}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
