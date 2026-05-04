export const SERVICE_ACCOUNT_PERMISSION_CATALOG = [
  { group: "Pipelines", value: "pipelines.read", label: "Read" },
  { group: "Pipelines", value: "pipelines.write", label: "Write" },
  { group: "Pipelines", value: "pipelines.deploy", label: "Deploy" },
  { group: "Pipelines", value: "pipelines.promote", label: "Promote" },
  { group: "Nodes", value: "nodes.read", label: "Read" },
  { group: "Nodes", value: "nodes.manage", label: "Manage" },
  { group: "Node Groups", value: "node-groups.read", label: "Read" },
  { group: "Node Groups", value: "node-groups.manage", label: "Manage" },
  { group: "Environments", value: "environments.read", label: "Read" },
  { group: "Metrics", value: "metrics.read", label: "Read" },
  { group: "Secrets", value: "secrets.read", label: "Read" },
  { group: "Secrets", value: "secrets.manage", label: "Manage" },
  { group: "Alerts", value: "alerts.read", label: "Read" },
  { group: "Alerts", value: "alerts.manage", label: "Manage" },
  { group: "Audit", value: "audit.read", label: "Read" },
  { group: "Audit", value: "audit.export", label: "Export" },
  { group: "Deploy Requests", value: "deploy-requests.manage", label: "Manage" },
  { group: "Migration", value: "migration.read", label: "Read" },
  { group: "Migration", value: "migration.write", label: "Write" },
] as const;

export type ServiceAccountPermission =
  (typeof SERVICE_ACCOUNT_PERMISSION_CATALOG)[number]["value"];

export const SERVICE_ACCOUNT_PERMISSIONS = SERVICE_ACCOUNT_PERMISSION_CATALOG.map(
  (permission) => permission.value,
) as [ServiceAccountPermission, ...ServiceAccountPermission[]];

const GROUPS = [
  "Pipelines",
  "Nodes",
  "Node Groups",
  "Environments",
  "Metrics",
  "Secrets",
  "Alerts",
  "Audit",
  "Deploy Requests",
  "Migration",
] as const;

export const SERVICE_ACCOUNT_PERMISSION_GROUPS = GROUPS.map((group) => ({
  label: group,
  permissions: SERVICE_ACCOUNT_PERMISSION_CATALOG.filter(
    (permission) => permission.group === group,
  ).map(({ value, label }) => ({ value, label })),
}));
