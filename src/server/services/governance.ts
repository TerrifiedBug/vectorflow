import { ALL_DLP_TEMPLATES } from "@/server/services/dlp-templates";

type ComponentKind = "SOURCE" | "TRANSFORM" | "SINK";

export interface GovernanceNode {
  id: string;
  componentKey: string;
  displayName: string | null;
  componentType: string;
  kind: ComponentKind;
  config: unknown;
}

export interface GovernanceEdge {
  sourceNodeId: string;
  targetNodeId: string;
}

export interface GovernancePipeline {
  id: string;
  name: string;
  tags: unknown;
  nodes: GovernanceNode[];
  edges: GovernanceEdge[];
}

export interface DestinationPolicy {
  allowedSinkTypes?: string[];
  deniedSinkTypes?: string[];
}

export interface GovernancePostureInput {
  scimEnabled: boolean;
  oidcGroupSyncEnabled: boolean;
  auditLogCount: number;
  auditShippingConfigured: boolean;
  totalUsers: number;
  manuallyManagedUsers: number;
  teamsWithAdmins: number;
  totalTeams: number;
  protectedSinks: number;
  totalSinks: number;
}

const dlpTemplatesByComponentType = new Map(
  ALL_DLP_TEMPLATES.map((template) => [
    template.id.replaceAll("-", "_"),
    template,
  ]),
);

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readConfigStringArray(config: unknown, key: string): string[] {
  if (!config || typeof config !== "object") return [];
  const value = (config as Record<string, unknown>)[key];
  return asStringArray(value);
}

function readTemplateDefaultFields(componentType: string): string[] {
  const template = dlpTemplatesByComponentType.get(componentType);
  if (!template) return [];
  return template.params
    .filter((param) => param.name === "fields" || param.name === "remove_fields")
    .flatMap((param) => asStringArray(param.default));
}

function collectUpstreamNodeIds(sinkId: string, edges: GovernanceEdge[]): Set<string> {
  const byTarget = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = byTarget.get(edge.targetNodeId) ?? [];
    existing.push(edge.sourceNodeId);
    byTarget.set(edge.targetNodeId, existing);
  }

  const visited = new Set<string>();
  const stack = [...(byTarget.get(sinkId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    stack.push(...(byTarget.get(current) ?? []));
  }
  return visited;
}

function describeDlpTransform(node: GovernanceNode) {
  const template = dlpTemplatesByComponentType.get(node.componentType);
  const configuredFields = [
    ...readConfigStringArray(node.config, "fields"),
    ...readConfigStringArray(node.config, "remove_fields"),
  ];
  return {
    id: node.id,
    componentKey: node.componentKey,
    displayName: node.displayName,
    componentType: node.componentType,
    complianceTags: template ? [...template.complianceTags] : [],
    redactedFields: configuredFields.length > 0 ? configuredFields : readTemplateDefaultFields(node.componentType),
  };
}

export function buildComplianceReport(input: { pipelines: GovernancePipeline[] }) {
  const pipelines = input.pipelines.map((pipeline) => {
    const dlpTransforms = pipeline.nodes
      .filter((node) => node.kind === "TRANSFORM" && node.componentType.startsWith("dlp_"))
      .map(describeDlpTransform);
    const dlpById = new Map(dlpTransforms.map((transform) => [transform.id, transform]));

    const sinks = pipeline.nodes
      .filter((node) => node.kind === "SINK")
      .map((sink) => {
        const upstreamIds = collectUpstreamNodeIds(sink.id, pipeline.edges);
        const upstreamDlpTransforms = [...upstreamIds]
          .map((id) => dlpById.get(id))
          .filter((transform): transform is NonNullable<typeof transform> => !!transform);
        const redactedFields = [...new Set(upstreamDlpTransforms.flatMap((transform) => transform.redactedFields))].sort();

        return {
          id: sink.id,
          componentKey: sink.componentKey,
          displayName: sink.displayName,
          componentType: sink.componentType,
          protected: upstreamDlpTransforms.length > 0,
          dlpTransforms: upstreamDlpTransforms,
          redactedFields,
        };
      });

    return {
      id: pipeline.id,
      name: pipeline.name,
      tags: asStringArray(pipeline.tags),
      dlpTransforms,
      sinks,
    };
  });

  const allSinks = pipelines.flatMap((pipeline) => pipeline.sinks);
  const allDlpTransforms = pipelines.flatMap((pipeline) => pipeline.dlpTransforms);

  return {
    summary: {
      pipelines: pipelines.length,
      sinks: allSinks.length,
      protectedSinks: allSinks.filter((sink) => sink.protected).length,
      unprotectedSinks: allSinks.filter((sink) => !sink.protected).length,
      dlpTransforms: allDlpTransforms.length,
    },
    pipelines,
  };
}

export function evaluateDestinationPolicy(input: {
  sinks: Array<{ componentKey: string; componentType: string }>;
  policy: DestinationPolicy;
}) {
  const allowed = new Set(input.policy.allowedSinkTypes ?? []);
  const denied = new Set(input.policy.deniedSinkTypes ?? []);

  return input.sinks.map((sink) => {
    if (denied.has(sink.componentType)) {
      return { ...sink, decision: "deny" as const, reason: "Sink type is explicitly denied" };
    }
    if (allowed.size > 0 && !allowed.has(sink.componentType)) {
      return { ...sink, decision: "deny" as const, reason: "Sink type is not in the allow list" };
    }
    return { ...sink, decision: "allow" as const, reason: "Sink type is allowed by policy" };
  });
}

function signalScore(status: "healthy" | "warning" | "critical") {
  if (status === "healthy") return 100;
  if (status === "warning") return 65;
  return 25;
}

export function summarizeGovernancePosture(input: GovernancePostureInput) {
  const identityStatus = input.scimEnabled || input.oidcGroupSyncEnabled ? "healthy" : "warning";
  const manualUserRatio = input.totalUsers === 0 ? 0 : input.manuallyManagedUsers / input.totalUsers;
  const rbacStatus = input.teamsWithAdmins < input.totalTeams ? "critical" : manualUserRatio > 0.25 ? "warning" : "healthy";
  const auditStatus = input.auditLogCount > 0 && input.auditShippingConfigured
    ? "healthy"
    : input.auditLogCount > 0
      ? "warning"
      : "critical";
  const protectedSinkRatio = input.totalSinks === 0 ? 1 : input.protectedSinks / input.totalSinks;
  const dlpStatus = protectedSinkRatio >= 0.9 ? "healthy" : protectedSinkRatio >= 0.5 ? "warning" : "critical";

  const signals = [
    {
      id: "identity",
      label: "Identity provisioning",
      status: identityStatus,
      detail: input.scimEnabled
        ? "SCIM provisioning is enabled"
        : input.oidcGroupSyncEnabled
          ? "OIDC group sync is enabled"
          : "SCIM and OIDC group sync are disabled",
    },
    {
      id: "rbac",
      label: "RBAC coverage",
      status: rbacStatus,
      detail: `${input.teamsWithAdmins}/${input.totalTeams} teams have admins; ${input.manuallyManagedUsers}/${input.totalUsers} users are manually managed`,
    },
    {
      id: "audit",
      label: "Audit trail",
      status: auditStatus,
      detail: input.auditShippingConfigured
        ? "Audit logs exist and shipping is configured"
        : "Audit shipping is not configured",
    },
    {
      id: "dlp",
      label: "DLP before destinations",
      status: dlpStatus,
      detail: `${input.protectedSinks}/${input.totalSinks} sinks have upstream DLP transforms`,
    },
  ] as const;

  return {
    score: Math.round(signals.reduce((sum, signal) => sum + signalScore(signal.status), 0) / signals.length),
    signals,
  };
}
