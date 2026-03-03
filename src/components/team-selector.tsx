"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users } from "lucide-react";

export function TeamSelector() {
  const trpc = useTRPC();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const setSelectedTeamId = useTeamStore((s) => s.setSelectedTeamId);

  const teamsQuery = useQuery(trpc.team.list.queryOptions());
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);

  // Auto-select first team if none selected
  useEffect(() => {
    if (!selectedTeamId && teams.length > 0) {
      setSelectedTeamId(teams[0].id);
    }
  }, [teams, selectedTeamId, setSelectedTeamId]);

  // If selected team is no longer in the list, reset
  useEffect(() => {
    if (selectedTeamId && teams.length > 0 && !teams.find((t) => t.id === selectedTeamId)) {
      setSelectedTeamId(teams[0].id);
    }
  }, [teams, selectedTeamId, setSelectedTeamId]);

  if (teams.length === 0) return null;

  // Single team — show name only, no dropdown
  if (teams.length === 1) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary">
          <Users className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-medium truncate">{teams[0].name}</span>
      </div>
    );
  }

  return (
    <Select value={selectedTeamId ?? undefined} onValueChange={setSelectedTeamId}>
      <SelectTrigger className="w-full h-auto border-sidebar-border bg-sidebar px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
            <Users className="h-3.5 w-3.5" />
          </div>
          <SelectValue placeholder="Select team" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {teams.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
