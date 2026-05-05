"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { isDemoMode } from "@/lib/is-demo-mode";
import { settingsNavGroups } from "@/components/settings-sidebar-nav";
import { VFIcon } from "@/components/ui/vf-icon";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * v2 Settings hub (D2): dense tile grid landing page linking to existing settings sub-routes.
 */
export function SettingsOverview() {
  const { data: session } = useSession();
  const user = session?.user as ({ isSuperAdmin?: boolean; role?: string } & NonNullable<typeof session>["user"]) | undefined;
  const isSuperAdmin = user?.isSuperAdmin === true;
  const userRole = user?.role;
  const isAdmin = isSuperAdmin || userRole === "ADMIN";

  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);
  const demoMode = isDemoMode();

  const readinessQuery = useQuery({
    ...trpc.settings.productionReadiness.queryOptions(),
    enabled: isSuperAdmin,
    staleTime: 5 * 60 * 1000,
  });
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
        if (!readinessQuery.data) return readinessQuery.isLoading ? <Skeleton className="mt-2 h-3 w-20" /> : null;
        const { overallStatus, signals } = readinessQuery.data;
        const errorCount = signals.filter((s) => s.status === "error").length;
        const warnCount = signals.filter((s) => s.status === "warn").length;
        if (overallStatus === "ok") return <StatusPill tone="ok">all clear</StatusPill>;
        if (errorCount > 0) return <StatusPill tone="error">{errorCount} error{errorCount === 1 ? "" : "s"}</StatusPill>;
        if (warnCount > 0) return <StatusPill tone="warn">{warnCount} warning{warnCount === 1 ? "" : "s"}</StatusPill>;
        return null;
      }
      case "Version Check": {
        if (!versionQuery.data) return versionQuery.isLoading ? <Skeleton className="mt-2 h-3 w-24" /> : null;
        const { server } = versionQuery.data;
        return (
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[10.5px] text-fg-2">{server.currentVersion}</span>
            <StatusPill tone={server.updateAvailable ? "warn" : "ok"}>
              {server.updateAvailable ? "update available" : "up to date"}
            </StatusPill>
          </div>
        );
      }
      case "Backup": {
        if (!settingsQuery.data) return settingsQuery.isLoading ? <Skeleton className="mt-2 h-3 w-20" /> : null;
        return (
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[10.5px] text-fg-2">
              {settingsQuery.data.lastBackupAt
                ? `last ${new Date(settingsQuery.data.lastBackupAt).toLocaleDateString()}`
                : "never backed up"}
            </span>
            {settingsQuery.data.lastBackupStatus === "failed" && <StatusPill tone="error">failed</StatusPill>}
          </div>
        );
      }
      case "Fleet": {
        if (!fleetQuery.data) return fleetQuery.isLoading ? <Skeleton className="mt-2 h-3 w-16" /> : null;
        return <p className="mt-2 font-mono text-[10.5px] text-fg-2">{fleetQuery.data.length} nodes registered</p>;
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
    <div className="space-y-7 bg-bg text-fg">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-fg-2">workspace / settings</div>
          <h1 className="mt-1 font-mono text-[22px] font-medium tracking-[-0.01em] text-fg">Settings</h1>
          <p className="mt-1 max-w-[720px] text-[12px] leading-relaxed text-fg-1">
            Manage identity, security, operations, and instance configuration.
          </p>
        </div>
      </div>

      {visibleGroups.map((group) => (
        <section key={group.label} className="space-y-3">
          <div>
            <h2 className="font-mono text-[14px] font-medium text-fg">{group.label}</h2>
            <p className="mt-0.5 text-[11.5px] text-fg-2">{group.description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
                  <Card className="h-full border-line bg-bg-2 transition-colors hover:border-line-2 hover:bg-bg-3">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-line-2 bg-bg-3 text-fg-1">
                          <Icon className="h-4 w-4" strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="truncate text-[12px] font-medium text-fg">{item.title}</h3>
                            <VFIcon name="chevron-right" size={13} className="text-fg-3" />
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-fg-1">{item.description}</p>
                          {getCardStatus(item.title)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-accent-line bg-accent-soft text-accent-brand"
      : tone === "warn"
        ? "border-status-degraded/40 bg-status-degraded-bg text-status-degraded"
        : "border-status-error/40 bg-status-error-bg text-status-error";
  return (
    <Badge variant="outline" className={`mt-2 rounded-[3px] font-mono text-[10px] uppercase tracking-[0.04em] ${cls}`}>
      {children}
    </Badge>
  );
}
