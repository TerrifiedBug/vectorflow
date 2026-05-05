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
  Activity,
  Send,
  Webhook,
  ClipboardCheck,
  Lock,
} from "lucide-react";

export const settingsNavGroups = [
  {
    label: "System",
    description: "Infrastructure and update management",
    items: [
      { title: "Production Readiness", description: "Aggregated health and configuration checklist for this VectorFlow instance.", href: "/settings/readiness", icon: ClipboardCheck, requiredSuperAdmin: true },
      { title: "Version Check", description: "Check for VectorFlow updates and view current version info.", href: "/settings/version", icon: RefreshCw, requiredSuperAdmin: true },
      { title: "Backup", description: "Configure automatic database backups and restore from backup.", href: "/settings/backup", icon: HardDrive, requiredSuperAdmin: true },
      { title: "Telemetry", description: "Opt in to anonymous usage telemetry that helps shape VectorFlow.", href: "/settings/telemetry", icon: Send, requiredSuperAdmin: true, demoHidden: true },
    ],
  },
  {
    label: "Security",
    description: "Identity, access, and credentials",
    items: [
      { title: "Authentication", description: "Configure OIDC providers, password policy, and two-factor authentication.", href: "/settings/auth", icon: Shield, requiredSuperAdmin: true },
      { title: "SCIM", description: "Provision users and groups from your identity provider.", href: "/settings/scim", icon: KeyRound, requiredSuperAdmin: true },
      { title: "Secrets", description: "Centralized vault for pipeline secrets across environments.", href: "/settings/secrets", icon: Lock, requiredSuperAdmin: false },
      { title: "Users", description: "Manage user accounts, roles, and access.", href: "/settings/users", icon: UserCog, requiredSuperAdmin: true, demoHidden: true },
    ],
  },
  {
    label: "Organization",
    description: "Teams, users, and integrations",
    items: [
      { title: "All Teams", description: "Create and manage teams for multi-tenant workspace isolation.", href: "/settings/teams", icon: Building2, requiredSuperAdmin: true },
      { title: "My Team", description: "Configure your team's name, environments, and preferences.", href: "/settings/team", icon: Users, requiredSuperAdmin: false, demoHidden: true },
      { title: "Service Accounts", description: "Create API tokens for CI/CD pipelines and external integrations.", href: "/settings/service-accounts", icon: Bot, requiredSuperAdmin: false, demoHidden: true },
      { title: "Outbound Webhooks", description: "Forward events to external systems via HMAC-signed POSTs.", href: "/settings/webhooks", icon: Webhook, requiredSuperAdmin: false, demoHidden: true },
      { title: "AI", description: "Configure AI assistant and LLM API keys.", href: "/settings/ai", icon: Sparkles, requiredSuperAdmin: false },
    ],
  },
  {
    label: "Operations",
    description: "Monitoring, fleet, and observability",
    items: [
      { title: "Fleet", description: "View and manage fleet nodes and their agent configuration.", href: "/settings/fleet", icon: Server, requiredSuperAdmin: true },
      { title: "Anomaly Detection", description: "Tune anomaly detection sensitivity, baseline windows, and monitored metrics.", href: "/settings/anomaly-detection", icon: Activity, requiredSuperAdmin: true },
      { title: "Audit Log Shipping", description: "Ship audit logs to an external SIEM or logging service.", href: "/settings/audit-shipping", icon: Upload, requiredSuperAdmin: true },
    ],
  },
];
