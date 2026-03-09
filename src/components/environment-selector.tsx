"use client";

import { useEffect, useMemo, useCallback, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, Plus, Settings, Star, CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EnvironmentSelector() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { selectedEnvironmentId, setSelectedEnvironmentId, setIsSystemEnvironment } =
    useEnvironmentStore();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

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

  // Fetch user preferences for default environment
  const prefsQuery = useQuery(trpc.userPreference.get.queryOptions());
  const prefKey = selectedTeamId ? `defaultEnvironmentId:${selectedTeamId}` : null;
  const defaultEnvironmentId = prefKey ? (prefsQuery.data?.[prefKey] ?? null) : null;

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

  // Auto-select first environment if none selected
  useEffect(() => {
    if (!selectedEnvironmentId && environments.length > 0) {
      setSelectedEnvironmentId(environments[0].id);
      setIsSystemEnvironment(false);
      wasAutoSelected.current = true;
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

  // Sync with user preference: if user has a default and current was auto-selected, switch to default
  useEffect(() => {
    if (
      defaultEnvironmentId &&
      environments.length > 0 &&
      environments.find((e) => e.id === defaultEnvironmentId) &&
      wasAutoSelected.current
    ) {
      setSelectedEnvironmentId(defaultEnvironmentId);
      setIsSystemEnvironment(false);
      wasAutoSelected.current = false;
    }
  }, [defaultEnvironmentId, environments, setSelectedEnvironmentId, setIsSystemEnvironment]);

  if (envsQuery.isLoading) {
    return <Skeleton className="h-8 w-[160px]" />;
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

  const selectedEnv =
    environments.find((e) => e.id === selectedEnvironmentId) ??
    (systemEnvironment && selectedEnvironmentId === systemEnvironment.id
      ? systemEnvironment
      : null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-[160px] items-center gap-2 rounded-md border bg-transparent px-3 py-2 text-xs whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 h-8",
          )}
        >
          <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate flex-1 text-left">
            {selectedEnv?.name ?? "Select environment"}
          </span>
          <ChevronDownIcon className="size-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-1" align="start">
        <div className="flex flex-col">
          {environments.map((env) => {
            const isSelected = env.id === selectedEnvironmentId;
            const isDefault = env.id === defaultEnvironmentId;
            return (
              <div
                key={env.id}
                className={cn(
                  "relative flex items-center gap-2 rounded-md py-1.5 pl-7 pr-8 text-sm cursor-default select-none hover:bg-accent hover:text-accent-foreground",
                  isSelected && "bg-accent text-accent-foreground",
                )}
                onClick={() => {
                  handleEnvironmentChange(env.id);
                  wasAutoSelected.current = false;
                  setOpen(false);
                }}
              >
                {/* Check indicator */}
                <span className="absolute left-2 flex size-3.5 items-center justify-center">
                  {isSelected && <CheckIcon className="size-4" />}
                </span>
                <span className="truncate">{env.name}</span>
                {/* Star button */}
                {prefKey && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (isDefault) {
                        deletePref.mutate({ key: prefKey });
                      } else {
                        setPref.mutate({ key: prefKey, value: env.id });
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
                )}
              </div>
            );
          })}
          {isSuperAdmin && systemEnvironment && (
            <>
              <div className="bg-border pointer-events-none -mx-1 my-1 h-px" />
              <div
                className={cn(
                  "relative flex items-center gap-2 rounded-md py-1.5 pl-7 pr-8 text-sm cursor-default select-none hover:bg-accent hover:text-accent-foreground text-muted-foreground",
                  selectedEnvironmentId === systemEnvironment.id && "bg-accent text-accent-foreground",
                )}
                onClick={() => {
                  handleEnvironmentChange(systemEnvironment.id);
                  wasAutoSelected.current = false;
                  setOpen(false);
                }}
              >
                <span className="absolute left-2 flex size-3.5 items-center justify-center">
                  {selectedEnvironmentId === systemEnvironment.id && <CheckIcon className="size-4" />}
                </span>
                <Settings className="h-3.5 w-3.5 shrink-0" />
                <span>System</span>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
