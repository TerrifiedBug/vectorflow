"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, Plus } from "lucide-react";

export function EnvironmentSelector() {
  const trpc = useTRPC();
  const { selectedEnvironmentId, setSelectedEnvironmentId } =
    useEnvironmentStore();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const envsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );
  const environments = envsQuery.data ?? [];

  // Auto-select first environment if none selected
  useEffect(() => {
    if (!selectedEnvironmentId && environments.length > 0) {
      setSelectedEnvironmentId(environments[0].id);
    }
  }, [environments, selectedEnvironmentId, setSelectedEnvironmentId]);

  if (envsQuery.isLoading) {
    return <Skeleton className="h-9 w-[180px]" />;
  }

  if (environments.length === 0) {
    return (
      <Button variant="outline" size="sm" className="h-9 text-xs text-muted-foreground" asChild>
        <Link href="/environments">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Create Environment
        </Link>
      </Button>
    );
  }

  return (
    <Select
      value={selectedEnvironmentId ?? ""}
      onValueChange={setSelectedEnvironmentId}
    >
      <SelectTrigger className="h-8 w-[180px] text-xs">
        <Layers className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue placeholder="Select environment" />
      </SelectTrigger>
      <SelectContent>
        {environments.map((env) => (
          <SelectItem key={env.id} value={env.id}>
            {env.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
