/**
 * Structural types for FluentD config parsing.
 * These types describe the parsed AST — they do NOT attempt to translate
 * FluentD concepts to Vector equivalents.
 */

export interface ParsedBlock {
  /** Unique ID for this block within the parsed config */
  id: string;
  /** FluentD block directive type */
  blockType: "source" | "match" | "filter" | "label" | "system";
  /** The @type plugin value, e.g. "tail", "elasticsearch" */
  pluginType: string;
  /** Tag pattern from <match pattern> or <filter pattern> directives */
  tagPattern: string | null;
  /** Label name from <label @name> directives */
  labelName: string | null;
  /** Key-value params extracted from the block (excluding @type) */
  params: Record<string, string>;
  /** Nested sub-blocks: <buffer>, <parse>, <format>, <store>, <server>, <secondary>, <inject>, <extract> */
  nestedBlocks: ParsedBlock[];
  /** Ruby expressions found in param values — flagged for AI attention */
  rubyExpressions: string[];
  /** The original raw text of this block for AI context */
  rawText: string;
  /** Line range [startLine, endLine] in the original config (1-indexed) */
  lineRange: [number, number];
}

export interface ParsedConfig {
  /** Top-level parsed blocks */
  blocks: ParsedBlock[];
  /** @include directives found (flagged as external dependencies) */
  includes: string[];
  /** Global-scope params (outside any directive block) */
  globalParams: Record<string, string>;
  /** Complexity metrics for readiness assessment */
  complexity: {
    totalBlocks: number;
    rubyExpressionCount: number;
    uniquePlugins: string[];
    routingBranches: number;
    nestedBlockDepth: number;
    includeCount: number;
  };
}

/** Known FluentD plugins that have direct Vector equivalents */
export const WELL_KNOWN_PLUGINS: Record<string, { vectorType: string; kind: "source" | "transform" | "sink"; confidence: number }> = {
  // Sources
  tail: { vectorType: "file", kind: "source", confidence: 95 },
  forward: { vectorType: "fluent", kind: "source", confidence: 90 },
  syslog: { vectorType: "syslog", kind: "source", confidence: 90 },
  http: { vectorType: "http_server", kind: "source", confidence: 85 },
  tcp: { vectorType: "socket", kind: "source", confidence: 85 },
  udp: { vectorType: "socket", kind: "source", confidence: 85 },
  unix: { vectorType: "socket", kind: "source", confidence: 80 },
  monitor_agent: { vectorType: "internal_metrics", kind: "source", confidence: 70 },
  // Sinks (match outputs)
  elasticsearch: { vectorType: "elasticsearch", kind: "sink", confidence: 90 },
  kafka: { vectorType: "kafka", kind: "sink", confidence: 90 },
  kafka2: { vectorType: "kafka", kind: "sink", confidence: 90 },
  s3: { vectorType: "aws_s3", kind: "sink", confidence: 85 },
  file: { vectorType: "file", kind: "sink", confidence: 90 },
  stdout: { vectorType: "console", kind: "sink", confidence: 95 },
  datadog: { vectorType: "datadog_logs", kind: "sink", confidence: 85 },
  loki: { vectorType: "loki", kind: "sink", confidence: 85 },
  splunk_hec: { vectorType: "splunk_hec_logs", kind: "sink", confidence: 85 },
  // Filters → transforms
  record_transformer: { vectorType: "remap", kind: "transform", confidence: 80 },
  parser: { vectorType: "remap", kind: "transform", confidence: 75 },
  grep: { vectorType: "filter", kind: "transform", confidence: 85 },
  geoip: { vectorType: "remap", kind: "transform", confidence: 70 },
};

export interface ReadinessReport {
  score: number; // 0-100
  summary: string;
  factors: ReadinessFactor[];
  pluginInventory: PluginInfo[];
}

export interface ReadinessFactor {
  name: string;
  weight: number;
  score: number;
  details: string;
}

export interface PluginInfo {
  pluginType: string;
  blockType: string;
  count: number;
  hasVectorEquivalent: boolean;
  vectorEquivalent: string | null;
  confidence: number;
}

/** Per-block AI translation result */
export interface TranslatedBlock {
  blockId: string;
  componentType: string;
  componentId: string;
  kind: "source" | "transform" | "sink";
  config: Record<string, unknown>;
  inputs: string[];
  confidence: number;
  notes: string[];
  validationErrors: string[];
  status: "translated" | "failed" | "skipped";
}

export interface TranslationResult {
  blocks: TranslatedBlock[];
  vectorYaml: string;
  overallConfidence: number;
  warnings: string[];
}
