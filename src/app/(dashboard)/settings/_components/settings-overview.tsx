"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { isDemoMode } from "@/lib/is-demo-mode";
import { settingsNavGroups } from "@/components/settings-sidebar-nav";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsOverview() {
  const { data: session } = useSession();
  const user = session?.user as ({ isSuperAdmin?: boolean; role?: string } & NonNullable<typeof session>["user"]) | undefined;
  const isSuperAdmin = user?.isSuperAdmin === true;
  const userRole = user?.role;
  const isAdmin = isSuperAdmin || userRole === "ADMIN";

  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);
  const demoMode = isDemoMode();

  // Production readiness — only for super admins
  const readinessQuery = useQuery({
    ...trpc.settings.productionReadiness.queryOptions(),
    enabled: isSuperAdmin,
    staleTime: 5 * 60 * 1000,
  });

  // Version check — only for super admins
  const versionQuery = useQuery({
    ...trpc.settings.checkVersion.queryOptions(),
    enabled: isSuperAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const settingsQuery = useQuery({
    ...trpc.settings.get.queryOptions(),
    enabled: isSuperAdmin,
    retry: false,
  });

  const fleetQuery = useQuery({
    ...trpc.fleet.list.queryOptions({ environmentId: selectedEnvironmentId ?? "" }),
    enabled: isSuperAdmin && !!selectedEnvironmentId,
  });

  function getCardStatus(title: string): React.ReactNode {
    switch (title) {
      case "Production Readiness": {
        if (!readinessQuery.data) return readinessQuery.isLoading ? <Skeleton className="h-4 w-20 mt-1.5" /> : null;
        const { overallStatus, signals } = readinessQuery.data;
        const errorCount = signals.filter((s) => s.status === "error").length;
        const warnCount = signals.filter((s) => s.status === "warn").length;
        const unknownCount = signals.filter((s) => s.status === "unknown").length;
        return (
          <div className="mt-1.5 flex items-center gap-2">
            {overallStatus === "ok" && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 border-green-600">All clear</Badge>
            )}
            {errorCount > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{errorCount} error{errorCount !== 1 ? "s" : ""}</Badge>
            )}
            {warnCount > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-yellow-600 border-yellow-500">{warnCount} warning{warnCount !== 1 ? "s" : ""}</Badge>
            )}
            {unknownCount > 0 && errorCount === 0 && warnCount === 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">{unknownCount} unknown</Badge>
            )}
          </div>
        );
      }
      case "Version Check": {
        if (!versionQuery.data) return versionQuery.isLoading ? <Skeleton className="h-4 w-24 mt-1.5" /> : null;
        const { server } = versionQuery.data;
        return (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">{server.currentVersion}</span>
            {server.updateAvailable ? (
              <Badge variant="default" className="text-[10px] px-1.5 py-0">Update available</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 border-green-600">Up to date</Badge>
            )}
          </div>
        );
      }
      case "Backup": {
        if (!settingsQuery.data) return settingsQuery.isLoading ? <Skeleton className="h-4 w-20 mt-1.5" /> : null;
        const lastBackup = settingsQuery.data.lastBackupAt;
        return (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {lastBackup ? `Last: ${new Date(lastBackup).toLocaleDateString()}` : "Never backed up"}
            </span>
            {settingsQuery.data.lastBackupStatus === "failed" && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Failed</Badge>
            )}
          </div>
        );
      }
      case "Fleet": {
        if (!fleetQuery.data) return fleetQuery.isLoading ? <Skeleton className="h-4 w-16 mt-1.5" /> : null;
        const nodeCount = fleetQuery.data.length;
        return (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {nodeCount} {nodeCount === 1 ? "node" : "nodes"} registered
          </p>
        );
      }
      default:
        return null;
    }
  }

  const visibleGroups = settingsNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (demoMode && item.demoHidden) return false;
        if (item.requiredSuperAdmin) return isSuperAdmin;
        return isAdmin;
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your VectorFlow instance configuration.
        </p>
      </div>

      {visibleGroups.map((group) => (
        <div key={group.label} className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{group.label}</h2>
            <p className="text-xs text-muted-foreground">{group.description}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <Card className="h-full transition-colors hover:bg-accent/50 cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                          <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                        </div>
                        <CardTitle className="text-sm font-semibold">{item.title}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="text-xs">
                        {item.description}
                      </CardDescription>
                      {getCardStatus(item.title)}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
