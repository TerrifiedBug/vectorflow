import {
  RefreshCw,
  Upload,
  Shield,
  Server,
  Users,
  UserCog,
  Building2,
  HardDrive,
  KeyRound,
  Bot,
  Sparkles,
  Webhook,
  Activity,
  Send,
} from "lucide-react";

export const settingsNavGroups = [
  {
    label: "System",
    items: [
      { title: "Version Check", href: "/settings/version", icon: RefreshCw, requiredSuperAdmin: true },
      { title: "Backup", href: "/settings/backup", icon: HardDrive, requiredSuperAdmin: true },
      { title: "Telemetry", href: "/settings/telemetry", icon: Send, requiredSuperAdmin: true },
    ],
  },
  {
    label: "Security",
    items: [
      { title: "Authentication", href: "/settings/auth", icon: Shield, requiredSuperAdmin: true },
      { title: "SCIM", href: "/settings/scim", icon: KeyRound, requiredSuperAdmin: true },
      { title: "Users", href: "/settings/users", icon: UserCog, requiredSuperAdmin: true, demoHidden: true },
    ],
  },
  {
    label: "Organization",
    items: [
      { title: "All Teams", href: "/settings/teams", icon: Building2, requiredSuperAdmin: true },
      { title: "My Team", href: "/settings/team", icon: Users, requiredSuperAdmin: false, demoHidden: true },
      { title: "Service Accounts", href: "/settings/service-accounts", icon: Bot, requiredSuperAdmin: false, demoHidden: true },
      { title: "Outbound Webhooks", href: "/settings/webhooks", icon: Webhook, requiredSuperAdmin: false },
      { title: "AI", href: "/settings/ai", icon: Sparkles, requiredSuperAdmin: false },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Fleet", href: "/settings/fleet", icon: Server, requiredSuperAdmin: true },
      { title: "Anomaly Detection", href: "/settings/anomaly-detection", icon: Activity, requiredSuperAdmin: true },
      { title: "Audit Log Shipping", href: "/settings/audit-shipping", icon: Upload, requiredSuperAdmin: true },
    ],
  },
];
