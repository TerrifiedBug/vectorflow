"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import {
  RefreshCw,
  HardDrive,
  Shield,
  KeyRound,
  UserCog,
  Building2,
  Users,
  Bot,
  Sparkles,
  Server,
  Upload,
  Activity,
  Send,
  Webhook,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface SettingsCategory {
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredSuperAdmin: boolean;
}

const CATEGORIES: SettingsCategory[] = [
  {
    title: "Version Check",
    description: "Check for VectorFlow updates and view current version info.",
    href: "/settings/version",
    icon: RefreshCw,
    requiredSuperAdmin: true,
  },
  {
    title: "Backup",
    description: "Configure automatic database backups and restore from backup.",
    href: "/settings/backup",
    icon: HardDrive,
    requiredSuperAdmin: true,
  },
  {
    title: "Telemetry",
    description: "Opt in to anonymous usage telemetry that helps shape VectorFlow.",
    href: "/settings/telemetry",
    icon: Send,
    requiredSuperAdmin: true,
  },
  {
    title: "Authentication",
    description: "Configure OIDC providers, password policy, and two-factor authentication.",
    href: "/settings/auth",
    icon: Shield,
    requiredSuperAdmin: true,
  },
  {
    title: "SCIM",
    description: "Provision users and groups from your identity provider.",
    href: "/settings/scim",
    icon: KeyRound,
    requiredSuperAdmin: true,
  },
  {
    title: "Users",
    description: "Manage user accounts, roles, and access.",
    href: "/settings/users",
    icon: UserCog,
    requiredSuperAdmin: true,
  },
  {
    title: "All Teams",
    description: "Create and manage teams for multi-tenant workspace isolation.",
    href: "/settings/teams",
    icon: Building2,
    requiredSuperAdmin: true,
  },
  {
    title: "My Team",
    description: "Configure your team's name, environments, and preferences.",
    href: "/settings/team",
    icon: Users,
    requiredSuperAdmin: false,
  },
  {
    title: "Service Accounts",
    description: "Create API tokens for CI/CD pipelines and external integrations.",
    href: "/settings/service-accounts",
    icon: Bot,
    requiredSuperAdmin: false,
  },
  {
    title: "AI",
    description: "Configure AI assistant and LLM API keys.",
    href: "/settings/ai",
    icon: Sparkles,
    requiredSuperAdmin: false,
  },
  {
    title: "Fleet",
    description: "View and manage fleet nodes and their agent configuration.",
    href: "/settings/fleet",
    icon: Server,
    requiredSuperAdmin: true,
  },
  {
    title: "Anomaly Detection",
    description: "Tune anomaly detection sensitivity, baseline windows, and monitored metrics.",
    href: "/settings/anomaly-detection",
    icon: Activity,
    requiredSuperAdmin: true,
  },
  {
    title: "Audit Log Shipping",
    description: "Ship audit logs to an external SIEM or logging service.",
    href: "/settings/audit-shipping",
    icon: Upload,
    requiredSuperAdmin: true,
  },
  {
    title: "Outbound Webhooks",
    description: "Forward events (deploys, version changes, fleet activity) to external systems via HMAC-signed POSTs.",
    href: "/settings/webhooks",
    icon: Webhook,
    requiredSuperAdmin: false,
  },
];

export function SettingsOverview() {
  const { data: session } = useSession();
  const user = session?.user as ({ isSuperAdmin?: boolean; role?: string } & NonNullable<typeof session>["user"]) | undefined;
  const isSuperAdmin = user?.isSuperAdmin === true;
  const userRole = user?.role;
  const isAdmin = isSuperAdmin || userRole === "ADMIN";

  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  // Version check — only for super admins
  const versionQuery = useQuery({
    ...trpc.settings.checkVersion.queryOptions(),
    enabled: isSuperAdmin,
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
  });

  // Settings (includes backup info) — only for super admins
  const settingsQuery = useQuery({
    ...trpc.settings.get.queryOptions(),
    enabled: isSuperAdmin,
    retry: false,
  });

  // Fleet node count — only for super admins with an environment selected
  const fleetQuery = useQuery({
    ...trpc.fleet.list.queryOptions({ environmentId: selectedEnvironmentId ?? "" }),
    enabled: isSuperAdmin && !!selectedEnvironmentId,
  });

  /** Inline status hints keyed by card title */
  function getCardStatus(title: string): React.ReactNode {
    switch (title) {
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

  const visibleCategories = CATEGORIES.filter((cat) => {
    if (cat.requiredSuperAdmin) return isSuperAdmin;
    return isAdmin;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your VectorFlow instance configuration.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleCategories.map((cat) => {
          const Icon = cat.icon;
          return (
            <Link key={cat.href} href={cat.href}>
              <Card className="h-full transition-colors hover:bg-accent/50 cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                      <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                    </div>
                    <CardTitle className="text-sm font-semibold">{cat.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-xs">
                    {cat.description}
                  </CardDescription>
                  {getCardStatus(cat.title)}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
