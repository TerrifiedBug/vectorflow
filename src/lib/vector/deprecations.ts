import type { VectorComponentDef } from "./types";

/** Component kind as used throughout the Vector catalog. */
export type ComponentKindName = VectorComponentDef["kind"];

/**
 * A deprecated/renamed/removed Vector component and the modern component to
 * migrate to. Every entry is sourced from Vector's official upgrade guides and
 * component docs (see the per-entry citations in the dataset below) — this list
 * MUST NOT contain unverified entries, since a wrong nudge erodes trust.
 */
export interface ComponentDeprecation {
  /** Deprecated component `type` as it appears in a Vector config / imported pipeline. */
  type: string;
  /**
   * Restrict the match to a single kind. REQUIRED when the same name is
   * deprecated for one kind while remaining current for another — e.g. the
   * `splunk_hec` *sink* was renamed but the `splunk_hec` *source* is current,
   * and `prometheus` maps to a different replacement per kind. Omit only when
   * the name is unambiguously deprecated for every kind it ever had.
   */
  kind?: ComponentKindName;
  /** Modern component `type` to migrate to (MUST exist in the current catalog). */
  replacement: string;
  /** Why it is deprecated, plus migration context, for the inline nudge copy. */
  reason: string;
  /** Vector version that removed the old name, when known. */
  removedIn?: string;
}

/**
 * Transforms removed in Vector 0.24.0 in favor of the `remap` transform (VRL).
 * Source: https://vector.dev/highlights/2022-08-16-0-24-0-upgrade-guide/#deprecated-transforms
 */
const REMAP_REPLACED_TRANSFORMS = [
  "add_fields",
  "add_tags",
  "ansi_stripper",
  "aws_cloudwatch_logs_subscription_parser",
  "coercer",
  "concat",
  "grok_parser",
  "json_parser",
  "key_value_parser",
  "logfmt_parser",
  "merge",
  "regex_parser",
  "remove_fields",
  "remove_tags",
  "rename_fields",
  "split",
  "tokenizer",
] as const;

export const COMPONENT_DEPRECATIONS: readonly ComponentDeprecation[] = [
  // ── Renamed; old names removed in Vector 0.25.0 ──
  // https://vector.dev/highlights/2022-08-16-0-24-0-upgrade-guide/#deprecated-components
  {
    type: "generator",
    kind: "source",
    replacement: "demo_logs",
    reason: "The generator source was renamed to demo_logs.",
    removedIn: "0.25.0",
  },
  {
    type: "docker",
    kind: "source",
    replacement: "docker_logs",
    reason: "The docker source was renamed to docker_logs.",
    removedIn: "0.25.0",
  },
  {
    type: "logplex",
    kind: "source",
    replacement: "heroku_logs",
    reason: "The logplex source was renamed to heroku_logs.",
    removedIn: "0.25.0",
  },
  {
    type: "prometheus",
    kind: "source",
    replacement: "prometheus_scrape",
    reason: "The prometheus source was renamed to prometheus_scrape.",
    removedIn: "0.25.0",
  },
  {
    type: "prometheus",
    kind: "sink",
    replacement: "prometheus_exporter",
    reason: "The prometheus sink was renamed to prometheus_exporter.",
    removedIn: "0.25.0",
  },
  {
    type: "swimlanes",
    kind: "transform",
    replacement: "route",
    reason: "The swimlanes transform was renamed to route.",
    removedIn: "0.25.0",
  },
  {
    type: "sampler",
    kind: "transform",
    replacement: "sample",
    reason: "The sampler transform was renamed to sample.",
    removedIn: "0.25.0",
  },
  {
    type: "new_relic_logs",
    kind: "sink",
    replacement: "new_relic",
    reason: "The new_relic_logs sink was renamed to new_relic.",
    removedIn: "0.25.0",
  },
  {
    // The splunk_hec *sink* was renamed; the splunk_hec *source* is still current,
    // so this entry is sink-scoped to avoid flagging the valid source.
    type: "splunk_hec",
    kind: "sink",
    replacement: "splunk_hec_logs",
    reason: "The splunk_hec sink was renamed to splunk_hec_logs.",
    removedIn: "0.25.0",
  },

  // ── Vendor rebrand ──
  // https://vector.dev/highlights/2023-04-11-0-29-0-upgrade-guide/
  {
    type: "logdna",
    kind: "sink",
    replacement: "mezmo",
    reason:
      "Following the LogDNA → Mezmo rebrand, the logdna sink was renamed to mezmo.",
  },

  // ── Deprecated in favor of remap + a geoip enrichment table ──
  // https://vector.dev/highlights/2022-08-16-0-24-0-upgrade-guide/#geoip-deprecation
  {
    type: "geoip",
    kind: "transform",
    replacement: "remap",
    reason:
      "The geoip transform was deprecated in favor of the remap transform with a geoip enrichment table.",
  },

  // ── Transforms removed in 0.24.0 in favor of remap (VRL) ──
  ...REMAP_REPLACED_TRANSFORMS.map(
    (type): ComponentDeprecation => ({
      type,
      kind: "transform",
      replacement: "remap",
      reason: `The ${type} transform was removed in favor of the remap transform (VRL).`,
      removedIn: "0.24.0",
    }),
  ),
];

/**
 * Look up the deprecation record for a component `type` + `kind`.
 *
 * Kind disambiguation: a kind-specific entry that matches `kind` wins; otherwise
 * a kind-agnostic entry applies. If every candidate is kind-scoped and none
 * matches `kind`, the component is NOT deprecated for that kind (e.g. the
 * splunk_hec *source*).
 */
export function findComponentDeprecation(
  type: string,
  kind: ComponentKindName,
): ComponentDeprecation | undefined {
  const candidates = COMPONENT_DEPRECATIONS.filter((d) => d.type === type);
  if (candidates.length === 0) return undefined;
  const kindMatch = candidates.find((d) => d.kind === kind);
  if (kindMatch) return kindMatch;
  return candidates.find((d) => d.kind === undefined);
}

/** A pipeline node carrying a deprecated component, ready for an inline nudge. */
export interface DeprecationFinding {
  /** Pipeline node id, so the editor can highlight the affected node. */
  nodeId: string;
  /** Node display name (falls back to the component type) for the nudge copy. */
  nodeName: string;
  /** The deprecated component type the node uses. */
  type: string;
  kind: ComponentKindName;
  /** The modern component type to migrate to. */
  replacement: string;
  reason: string;
  removedIn?: string;
}

/** Minimal pipeline-node shape needed to detect deprecated components. */
export interface DeprecatableNode {
  id: string;
  componentType: string;
  /** Accepts the Prisma `ComponentKind` enum (SOURCE/…) or a catalog kind; matched case-insensitively. */
  kind: string;
  displayName?: string | null;
}

/**
 * Scan pipeline nodes and return an upgrade nudge for every deprecated
 * component. Pure + side-effect free so it can run on any node list (saved
 * pipeline, imported config, preview) and be unit-tested in isolation.
 */
export function findDeprecatedComponents(
  nodes: readonly DeprecatableNode[],
): DeprecationFinding[] {
  const findings: DeprecationFinding[] = [];
  for (const node of nodes) {
    // Advisory only: a malformed/partial node (missing type or kind) must never
    // break the caller (e.g. the pipeline `get` query) — skip it instead.
    if (typeof node.componentType !== "string" || typeof node.kind !== "string") {
      continue;
    }
    const kind = node.kind.toLowerCase() as ComponentKindName;
    const dep = findComponentDeprecation(node.componentType, kind);
    if (!dep) continue;
    findings.push({
      nodeId: node.id,
      nodeName: node.displayName?.trim() || node.componentType,
      type: node.componentType,
      kind,
      replacement: dep.replacement,
      reason: dep.reason,
      removedIn: dep.removedIn,
    });
  }
  return findings;
}
