"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Users, Star, CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function TeamSelector() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const setSelectedTeamId = useTeamStore((s) => s.setSelectedTeamId);
  const [open, setOpen] = useState(false);

  const teamsQuery = useQuery(trpc.team.list.queryOptions());
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);

  // Fetch user preferences for default team
  const prefsQuery = useQuery(trpc.userPreference.get.queryOptions());
  const defaultTeamId = prefsQuery.data?.defaultTeamId ?? null;

  const setPref = useMutation(
    trpc.userPreference.set.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.userPreference.get.queryKey(),
        });
      },
    }),
  );

  const deletePref = useMutation(
    trpc.userPreference.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.userPreference.get.queryKey(),
        });
      },
    }),
  );

  // Track whether initial selection was auto-selected (first-in-list)
  const wasAutoSelected = useRef(false);

  // Auto-select first team if none selected
  useEffect(() => {
    if (!selectedTeamId && teams.length > 0) {
      setSelectedTeamId(teams[0].id);
      wasAutoSelected.current = true;
    }
  }, [teams, selectedTeamId, setSelectedTeamId]);

  // If selected team is no longer in the list, reset
  useEffect(() => {
    if (selectedTeamId && teams.length > 0 && !teams.find((t) => t.id === selectedTeamId)) {
      setSelectedTeamId(teams[0].id);
      wasAutoSelected.current = true;
    }
  }, [teams, selectedTeamId, setSelectedTeamId]);

  // Sync with user preference: if user has a default and current was auto-selected, switch to default
  useEffect(() => {
    if (
      defaultTeamId &&
      teams.length > 0 &&
      teams.find((t) => t.id === defaultTeamId) &&
      wasAutoSelected.current
    ) {
      setSelectedTeamId(defaultTeamId);
      wasAutoSelected.current = false;
    }
  }, [defaultTeamId, teams, setSelectedTeamId]);

  if (teams.length === 0) return null;

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  // Single team — show name only, no dropdown
  if (teams.length === 1) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
        <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium truncate">{teams[0].name}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-[160px] items-center gap-2 rounded-md border bg-transparent px-3 py-2 text-xs whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 h-8",
          )}
        >
          <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate flex-1 text-left">
            {selectedTeam?.name ?? "Select team"}
          </span>
          <ChevronDownIcon className="size-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-1" align="start">
        <div className="flex flex-col">
          {teams.map((team) => {
            const isSelected = team.id === selectedTeamId;
            const isDefault = team.id === defaultTeamId;
            return (
              <div
                key={team.id}
                className={cn(
                  "relative flex items-center gap-2 rounded-md py-1.5 pl-7 pr-8 text-sm cursor-default select-none hover:bg-accent hover:text-accent-foreground",
                  isSelected && "bg-accent text-accent-foreground",
                )}
                onClick={() => {
                  setSelectedTeamId(team.id);
                  wasAutoSelected.current = false;
                  setOpen(false);
                }}
              >
                {/* Check indicator */}
                <span className="absolute left-2 flex size-3.5 items-center justify-center">
                  {isSelected && <CheckIcon className="size-4" />}
                </span>
                <span className="truncate">{team.name}</span>
                {/* Star button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (isDefault) {
                      deletePref.mutate({ key: "defaultTeamId" });
                    } else {
                      setPref.mutate({ key: "defaultTeamId", value: team.id });
                    }
                  }}
                  className="ml-auto shrink-0"
                >
                  <Star
                    className={cn(
                      "h-3.5 w-3.5",
                      isDefault
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground hover:text-yellow-400",
                    )}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
