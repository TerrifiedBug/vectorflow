"use client";

import { useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, Plus, Settings } from "lucide-react";

export function EnvironmentSelector() {
  const trpc = useTRPC();
  const { selectedEnvironmentId, setSelectedEnvironmentId, setIsSystemEnvironment } =
    useEnvironmentStore();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const pathname = usePathname();
  const router = useRouter();

  // Navigate back to list pages when switching environments from a detail page
  const handleEnvironmentChange = useCallback((id: string) => {
    setSelectedEnvironmentId(id);
    const detailRoutes = ["/pipelines/", "/fleet/"];
    if (detailRoutes.some((route) => pathname.startsWith(route) && pathname !== route)) {
      const parentRoute = detailRoutes.find((route) => pathname.startsWith(route));
      if (parentRoute) router.push(parentRoute.replace(/\/$/, ""));
    }
  }, [setSelectedEnvironmentId, pathname, router]);

  const envsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );
  const environments = useMemo(() => envsQuery.data ?? [], [envsQuery.data]);

  // Fetch current user info to check super admin status
  const { data: me } = useQuery(trpc.user.me.queryOptions());
  const isSuperAdmin = me?.isSuperAdmin ?? false;

  // Fetch system environment for super admins
  const systemEnvQuery = useQuery(
    trpc.environment.getSystem.queryOptions(undefined, {
      enabled: isSuperAdmin,
    }),
  );
  const systemEnvironment = systemEnvQuery.data;

  // Auto-select first environment if none selected
  useEffect(() => {
    if (!selectedEnvironmentId && environments.length > 0) {
      setSelectedEnvironmentId(environments[0].id);
      setIsSystemEnvironment(false);
    }
  }, [environments, selectedEnvironmentId, setSelectedEnvironmentId, setIsSystemEnvironment]);

  // Track whether selected environment is the system environment
  useEffect(() => {
    if (selectedEnvironmentId && systemEnvironment) {
      setIsSystemEnvironment(selectedEnvironmentId === systemEnvironment.id);
    } else {
      setIsSystemEnvironment(false);
    }
  }, [selectedEnvironmentId, systemEnvironment, setIsSystemEnvironment]);

  if (envsQuery.isLoading) {
    return <Skeleton className="h-8 w-full" />;
  }

  if (environments.length === 0 && !systemEnvironment) {
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
      onValueChange={handleEnvironmentChange}
    >
      <SelectTrigger className="h-8 w-full text-xs">
        <Layers className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue placeholder="Select environment" />
      </SelectTrigger>
      <SelectContent>
        {environments.map((env) => (
          <SelectItem key={env.id} value={env.id}>
            {env.name}
          </SelectItem>
        ))}
        {isSuperAdmin && systemEnvironment && (
          <>
            <SelectSeparator />
            <SelectItem
              value={systemEnvironment.id}
              className="text-muted-foreground"
            >
              <Settings className="mr-1.5 h-3.5 w-3.5" />
              System
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
