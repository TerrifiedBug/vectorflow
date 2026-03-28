"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
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
  Webhook,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

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
    title: "Teams",
    description: "Create and manage teams for multi-tenant workspace isolation.",
    href: "/settings/teams",
    icon: Building2,
    requiredSuperAdmin: true,
  },
  {
    title: "Team Settings",
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
    title: "Outbound Webhooks",
    description: "Configure webhooks to send events to external systems.",
    href: "/settings/webhooks",
    icon: Webhook,
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
    title: "Audit Log Shipping",
    description: "Ship audit logs to an external SIEM or logging service.",
    href: "/settings/audit-shipping",
    icon: Upload,
    requiredSuperAdmin: true,
  },
];

export function SettingsOverview() {
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.isSuperAdmin === true;
  const userRole = session?.user?.role;
  const isAdmin = isSuperAdmin || userRole === "ADMIN";

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
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
