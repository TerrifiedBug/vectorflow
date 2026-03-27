"use client";

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

export interface FleetHealthToolbarProps {
  groupFilter: string | null;
  onGroupFilterChange: (id: string | null) => void;
  labelFilter: Record<string, string>;
  onLabelFilterChange: (labels: Record<string, string>) => void;
  complianceFilter: "all" | "compliant" | "non-compliant";
  onComplianceFilterChange: (
    status: "all" | "compliant" | "non-compliant",
  ) => void;
  groups: Array<{ id: string; name: string }>;
  availableLabels: Record<string, string[]>;
}

const COMPLIANCE_OPTIONS = [
  { id: "all" as const, label: "All" },
  { id: "compliant" as const, label: "Compliant" },
  { id: "non-compliant" as const, label: "Non-compliant" },
];

export function FleetHealthToolbar({
  groupFilter,
  onGroupFilterChange,
  labelFilter,
  onLabelFilterChange,
  complianceFilter,
  onComplianceFilterChange,
  groups,
  availableLabels,
}: FleetHealthToolbarProps) {
  const labelKeys = Object.keys(availableLabels).sort();
  const activeLabelCount = Object.keys(labelFilter).length;
  const hasActiveFilters =
    groupFilter !== null ||
    activeLabelCount > 0 ||
    complianceFilter !== "all";

  const clearAll = () => {
    onGroupFilterChange(null);
    onLabelFilterChange({});
    onComplianceFilterChange("all");
  };

  const selectedGroup = groups.find((g) => g.id === groupFilter);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
      {/* Group filter dropdown */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1">
            {selectedGroup ? (
              <>
                Group:{" "}
                <span className="font-medium">{selectedGroup.name}</span>
              </>
            ) : (
              <>
                All Groups
                <span className="text-muted-foreground ml-1"></span>
              </>
            )}
            <ChevronsUpDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search groups..." />
            <CommandList>
              <CommandEmpty>No groups found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  onSelect={() => onGroupFilterChange(null)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      groupFilter === null ? "opacity-100" : "opacity-0",
                    )}
                  />
                  All Groups
                </CommandItem>
                {groups.map((group) => (
                  <CommandItem
                    key={group.id}
                    onSelect={() =>
                      onGroupFilterChange(
                        groupFilter === group.id ? null : group.id,
                      )
                    }
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        groupFilter === group.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {group.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div className="h-6 w-px bg-border" />

      {/* Compliance toggle pills */}
      <div className="flex items-center gap-1">
        {COMPLIANCE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onComplianceFilterChange(opt.id)}
            className={cn(
              "rounded-full px-3 h-7 text-xs font-medium border transition-colors",
              complianceFilter === opt.id
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
