// src/lib/vector/source-output-schemas.ts

export interface OutputFieldSchema {
  path: string;        // ".message", ".kubernetes.pod.name"
  type: string;        // "string" | "integer" | "float" | "boolean" | "timestamp" | "object" | "array"
  description: string; // Human-readable explanation
  always: boolean;     // true = always present in output events
}

export interface SourceOutputSchema {
  sourceType: string;           // matches VectorComponentDef.type
  fields: OutputFieldSchema[];
  rawText: boolean;             // true = .message is unparsed text by default
  suggestedTransforms: string[]; // VRL snippets for raw text sources
}

export const SOURCE_OUTPUT_SCHEMAS: SourceOutputSchema[] = [
  // ── Local Sources ──
  {
    sourceType: "file",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "Raw log line content", always: true },
      { path: ".host", type: "string", description: "Host machine name", always: true },
      { path: ".file", type: "string", description: "Source file path", always: true },
      { path: ".source_type", type: "string", description: "Always \"file\"", always: true },
      { path: ".timestamp", type: "timestamp", description: "Ingestion timestamp", always: true },
    ],
    suggestedTransforms: [
      '. = merge!(., parse_json!(.message))',
      '. = merge!(., parse_regex!(.message, r\'(?P<timestamp>\\S+) (?P<level>\\w+) (?P<msg>.*)\'))',
      '. = merge!(., parse_syslog!(.message))',
      '.parsed = parse_csv!(.message)',
    ],
  },
  {
    sourceType: "stdin",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "Raw input line", always: true },
      { path: ".timestamp", type: "timestamp", description: "Ingestion timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"stdin\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },
  {
    sourceType: "journald",
    rawText: false,
    fields: [
      { path: ".message", type: "string", description: "Journal entry message", always: true },
      { path: ".host", type: "string", description: "Hostname", always: true },
      { path: ".timestamp", type: "timestamp", description: "Journal timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"journald\"", always: true },
      { path: "._SYSTEMD_UNIT", type: "string", description: "Systemd unit name", always: false },
      { path: "._COMM", type: "string", description: "Process name", always: false },
      { path: "._PID", type: "string", description: "Process ID", always: false },
      { path: ".PRIORITY", type: "string", description: "Syslog priority level", always: false },
      { path: ".SYSLOG_FACILITY", type: "string", description: "Syslog facility", always: false },
    ],
    suggestedTransforms: [],
  },

  // ── Network Sources ──
  {
    sourceType: "syslog",
    rawText: false,
    fields: [
      { path: ".message", type: "string", description: "Log message content", always: true },
      { path: ".hostname", type: "string", description: "Originating host", always: true },
      { path: ".facility", type: "string", description: "Syslog facility (e.g. kern, user, daemon)", always: true },
      { path: ".severity", type: "string", description: "Syslog severity (e.g. info, warning, err)", always: true },
      { path: ".appname", type: "string", description: "Application name", always: false },
      { path: ".procid", type: "integer", description: "Process ID", always: false },
      { path: ".msgid", type: "string", description: "Message identifier", always: false },
      { path: ".timestamp", type: "timestamp", description: "Event timestamp", always: true },
      { path: ".version", type: "integer", description: "Syslog protocol version", always: false },
      { path: ".source_type", type: "string", description: "Always \"syslog\"", always: true },
    ],
    suggestedTransforms: [],
  },
  {
    sourceType: "http_server",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "Request body content", always: true },
      { path: ".path", type: "string", description: "HTTP request path", always: true },
      { path: ".timestamp", type: "timestamp", description: "Ingestion timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"http_server\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },
  {
    sourceType: "socket",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "Raw socket data", always: true },
      { path: ".host", type: "string", description: "Source host address", always: true },
      { path: ".timestamp", type: "timestamp", description: "Ingestion timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"socket\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },

  // ── Messaging Sources ──
  {
    sourceType: "kafka",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "Kafka message payload", always: true },
      { path: ".topic", type: "string", description: "Source Kafka topic", always: true },
      { path: ".partition", type: "integer", description: "Kafka partition number", always: true },
      { path: ".offset", type: "integer", description: "Message offset in partition", always: true },
      { path: ".timestamp", type: "timestamp", description: "Message timestamp", always: true },
      { path: ".headers", type: "object", description: "Kafka message headers", always: false },
      { path: ".source_type", type: "string", description: "Always \"kafka\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },
  {
    sourceType: "amqp",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "AMQP message body", always: true },
      { path: ".timestamp", type: "timestamp", description: "Ingestion timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"amqp\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },
  {
    sourceType: "nats",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "NATS message payload", always: true },
      { path: ".subject", type: "string", description: "NATS subject", always: true },
      { path: ".timestamp", type: "timestamp", description: "Ingestion timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"nats\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },
  {
    sourceType: "gcp_pubsub",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "Pub/Sub message data", always: true },
      { path: ".attributes", type: "object", description: "Message attributes", always: false },
      { path: ".message_id", type: "string", description: "Pub/Sub message ID", always: true },
      { path: ".publish_time", type: "timestamp", description: "Publish timestamp", always: true },
      { path: ".timestamp", type: "timestamp", description: "Ingestion timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"gcp_pubsub\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },
  {
    sourceType: "aws_s3",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "S3 object line content", always: true },
      { path: ".bucket", type: "string", description: "S3 bucket name", always: true },
      { path: ".object", type: "string", description: "S3 object key", always: true },
      { path: ".region", type: "string", description: "AWS region", always: true },
      { path: ".timestamp", type: "timestamp", description: "Ingestion timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"aws_s3\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },
  {
    sourceType: "aws_sqs",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "SQS message body", always: true },
      { path: ".timestamp", type: "timestamp", description: "Ingestion timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"aws_sqs\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },

  // ── Container Sources ──
  {
    sourceType: "docker_logs",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "Container log line", always: true },
      { path: ".container_id", type: "string", description: "Docker container ID", always: true },
      { path: ".container_name", type: "string", description: "Docker container name", always: true },
      { path: ".stream", type: "string", description: "\"stdout\" or \"stderr\"", always: true },
      { path: ".image", type: "string", description: "Docker image name", always: true },
      { path: ".label", type: "object", description: "Container labels", always: false },
      { path: ".timestamp", type: "timestamp", description: "Log timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"docker_logs\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },
  {
    sourceType: "kubernetes_logs",
    rawText: true,
    fields: [
      { path: ".message", type: "string", description: "Container log line", always: true },
      { path: ".kubernetes.pod_name", type: "string", description: "Kubernetes pod name", always: true },
      { path: ".kubernetes.pod_namespace", type: "string", description: "Pod namespace", always: true },
      { path: ".kubernetes.container_name", type: "string", description: "Container name within pod", always: true },
      { path: ".kubernetes.pod_labels", type: "object", description: "Pod labels", always: false },
      { path: ".kubernetes.pod_annotations", type: "object", description: "Pod annotations", always: false },
      { path: ".kubernetes.node_name", type: "string", description: "Node running the pod", always: false },
      { path: ".file", type: "string", description: "Container log file path", always: true },
      { path: ".stream", type: "string", description: "\"stdout\" or \"stderr\"", always: true },
      { path: ".timestamp", type: "timestamp", description: "Log timestamp", always: true },
      { path: ".source_type", type: "string", description: "Always \"kubernetes_logs\"", always: true },
    ],
    suggestedTransforms: ['. = merge!(., parse_json!(.message))'],
  },

  // ── Metric Sources ──
  {
    sourceType: "host_metrics",
    rawText: false,
    fields: [
      { path: ".name", type: "string", description: "Metric name (e.g. cpu_seconds_total)", always: true },
      { path: ".namespace", type: "string", description: "Metric namespace (\"host\")", always: true },
      { path: ".kind", type: "string", description: "Metric kind (e.g. \"absolute\")", always: true },
      { path: ".timestamp", type: "timestamp", description: "Collection timestamp", always: true },
    ],
    suggestedTransforms: [],
  },
  {
    sourceType: "internal_metrics",
    rawText: false,
    fields: [
      { path: ".name", type: "string", description: "Vector internal metric name", always: true },
      { path: ".namespace", type: "string", description: "Metric namespace (\"vector\")", always: true },
      { path: ".kind", type: "string", description: "Metric kind", always: true },
      { path: ".timestamp", type: "timestamp", description: "Collection timestamp", always: true },
    ],
    suggestedTransforms: [],
  },
  {
    sourceType: "prometheus_scrape",
    rawText: false,
    fields: [
      { path: ".name", type: "string", description: "Prometheus metric name", always: true },
      { path: ".namespace", type: "string", description: "Metric namespace", always: false },
      { path: ".tags", type: "object", description: "Metric labels", always: false },
      { path: ".kind", type: "string", description: "Metric kind", always: true },
      { path: ".timestamp", type: "timestamp", description: "Scrape timestamp", always: true },
    ],
    suggestedTransforms: [],
  },
];

/**
 * Look up the static output schema for a Vector source type.
 * Returns undefined if the source type isn't in the catalog.
 */
export function getSourceOutputSchema(sourceType: string): SourceOutputSchema | undefined {
  return SOURCE_OUTPUT_SCHEMAS.find((s) => s.sourceType === sourceType);
}

/**
 * Get merged field schemas for multiple source types.
 * Returns the union of all fields across all sources.
 * If the same path appears in multiple sources, keeps the first occurrence.
 */
export function getMergedOutputSchemas(sourceTypes: string[]): OutputFieldSchema[] {
  const seen = new Set<string>();
  const fields: OutputFieldSchema[] = [];
  for (const type of sourceTypes) {
    const schema = getSourceOutputSchema(type);
    if (!schema) continue;
    for (const f of schema.fields) {
      if (!seen.has(f.path)) {
        seen.add(f.path);
        fields.push(f);
      }
    }
  }
  return fields;
}
