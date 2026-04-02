// src/lib/ai/vector-docs-reference.ts
//
// Static Vector documentation reference for AI prompts.
// Sourced from vector.dev via Context7 — covers component configs and VRL patterns.
// All AI features (migration, cost optimizer, VRL chat, debug) share this.

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const SOURCES: Record<string, string> = {
  file: `type: file
include: ["/var/log/**/*.log"]  # required, glob patterns
exclude: ["/var/log/binary.*"]  # optional
read_from: "beginning"  # or "end" (default)
ignore_older_secs: 86400
max_line_bytes: 102400
fingerprint.strategy: "checksum"  # or "device_and_inode"`,

  aws_s3: `type: aws_s3
# SQS-based ingestion (required)
sqs.queue_url: "https://sqs.us-east-2.amazonaws.com/123456789012/MyQueue"
sqs.poll_secs: 20
sqs.delete_message: true
sqs.visibility_timeout_secs: 300
# Auth
auth.access_key_id: "\${AWS_ACCESS_KEY_ID}"
auth.secret_access_key: "\${AWS_SECRET_ACCESS_KEY}"
auth.assume_role: "arn:aws:iam::123456789:role/my-role"
auth.region: "us-east-1"
region: "us-east-1"
compression: "auto"  # auto, none, gzip, zstd`,

  aws_sqs: `type: aws_sqs
queue_url: "https://sqs.us-east-2.amazonaws.com/123456789012/MyQueue"
region: "us-east-1"
poll_secs: 15
visibility_timeout_secs: 300
delete_message: true`,

  http_server: `type: http_server
address: "0.0.0.0:8080"
encoding: "json"  # or "text"
path: "/events"`,

  kafka: `type: kafka
bootstrap_servers: "broker1:9092,broker2:9092"
group_id: "vector-consumer"
topics: ["my-topic"]
auto_offset_reset: "earliest"  # or "latest"`,

  syslog: `type: syslog
mode: "tcp"  # tcp, udp, or unix
address: "0.0.0.0:514"`,

  socket: `type: socket
mode: "tcp"  # tcp, udp, or unix
address: "0.0.0.0:9000"`,

  docker_logs: `type: docker_logs
# Requires access to Docker socket
include_containers: ["my-app-*"]
exclude_containers: ["vector"]`,

  journald: `type: journald
include_units: ["nginx.service", "my-app.service"]`,

  demo_logs: `type: demo_logs
format: "json"  # syslog, json, apache_common, apache_error
interval: 1.0`,

  internal_metrics: `type: internal_metrics
scrape_interval_secs: 15`,

  internal_logs: `type: internal_logs`,

  host_metrics: `type: host_metrics
scrape_interval_secs: 15
collectors: ["cpu", "memory", "disk", "network", "filesystem"]`,

  prometheus_scrape: `type: prometheus_scrape
endpoints: ["http://localhost:9090/metrics"]
scrape_interval_secs: 15`,

  kubernetes_logs: `type: kubernetes_logs`,

  statsd: `type: statsd
address: "0.0.0.0:8125"
mode: "udp"`,
};

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

const TRANSFORMS: Record<string, string> = {
  remap: `type: remap
inputs: ["source_id"]
source: |
  . = parse_json!(.message)
  .timestamp = now()
  del(.unwanted_field)`,

  filter: `type: filter
inputs: ["source_id"]
condition: '.severity != "debug"'`,

  route: `type: route
inputs: ["source_id"]
route:
  critical: '.severity == "critical"'
  warning: '.severity == "warning"'
# Use route._unmatched for events that don't match any route`,

  reduce: `type: reduce
inputs: ["source_id"]
group_by: ["request_id"]
merge_strategies:
  duration_ms: "max"
  status: "retain"`,

  dedupe: `type: dedupe
inputs: ["source_id"]
fields.match: ["message", "host"]
cache.num_events: 5000`,

  sample: `type: sample
inputs: ["source_id"]
rate: 10  # keep 1 in every 10`,

  throttle: `type: throttle
inputs: ["source_id"]
threshold: 100
window_secs: 60`,

  log_to_metric: `type: log_to_metric
inputs: ["source_id"]
metrics:
  - type: counter
    field: status
    name: status_total
    tags:
      status: "{{status}}"`,

  metric_to_log: `type: metric_to_log
inputs: ["metrics_source"]
host_tag: "host"`,

  lua: `type: lua
inputs: ["source_id"]
version: 2
hooks:
  process: process
source: |
  function process(event, emit)
    emit(event)
  end`,
};

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

const SINKS: Record<string, string> = {
  elasticsearch: `type: elasticsearch
inputs: ["transform_id"]
endpoints: ["https://es.example.com:9200"]
bulk.index: "my-index-%Y.%m.%d"
auth.strategy: "basic"
auth.user: "\${ES_USER}"
auth.password: "\${ES_PASSWORD}"
# For AWS OpenSearch:
# auth.strategy: "aws"
# auth.assume_role: "arn:aws:iam::123:role/my-role"
# opensearch_service_type: "managed"`,

  opensearch: `# Use the elasticsearch sink type for OpenSearch
type: elasticsearch
inputs: ["transform_id"]
endpoints: ["https://opensearch.example.com:9200"]
api_version: "v7"  # or "v8"
opensearch_service_type: "managed"  # for AWS OpenSearch Service
bulk.index: "my-index"
auth.strategy: "aws"
auth.assume_role: "arn:aws:iam::123:role/my-role"
auth.region: "eu-central-1"`,

  kafka: `type: kafka
inputs: ["transform_id"]
bootstrap_servers: "broker1:9092,broker2:9092"
topic: "my-output-topic"
encoding.codec: "json"
compression: "snappy"`,

  aws_s3: `type: aws_s3
inputs: ["transform_id"]
bucket: "my-bucket"
key_prefix: "logs/%Y/%m/%d/"
region: "us-east-1"
compression: "gzip"
encoding.codec: "ndjson"`,

  aws_cloudwatch_logs: `type: aws_cloudwatch_logs
inputs: ["transform_id"]
group_name: "/my/log-group"
stream_name: "{{ host }}"
region: "us-east-1"
encoding.codec: "json"`,

  loki: `type: loki
inputs: ["transform_id"]
endpoint: "http://loki:3100"
labels:
  source: "vector"
  job: "my-app"
encoding.codec: "json"`,

  datadog_logs: `type: datadog_logs
inputs: ["transform_id"]
default_api_key: "\${DD_API_KEY}"
site: "datadoghq.com"`,

  splunk_hec_logs: `type: splunk_hec_logs
inputs: ["transform_id"]
endpoint: "https://splunk:8088"
token: "\${SPLUNK_HEC_TOKEN}"
index: "main"
encoding.codec: "json"`,

  http: `type: http
inputs: ["transform_id"]
uri: "https://api.example.com/v1/ingest"
encoding.codec: "json"
compression: "gzip"
auth.strategy: "bearer"
auth.token: "\${API_TOKEN}"`,

  file: `type: file
inputs: ["transform_id"]
path: "/var/log/output/%Y/%m/%d/events.log"
encoding.codec: "ndjson"`,

  console: `type: console
inputs: ["transform_id"]
encoding.codec: "json"`,

  prometheus_exporter: `type: prometheus_exporter
inputs: ["metrics_transform"]
address: "0.0.0.0:9598"`,

  prometheus_remote_write: `type: prometheus_remote_write
inputs: ["metrics_transform"]
endpoint: "http://prometheus:9090/api/v1/write"`,

  clickhouse: `type: clickhouse
inputs: ["transform_id"]
endpoint: "http://localhost:8123"
table: "my_table"
database: "default"`,
};

// ---------------------------------------------------------------------------
// FluentD → Vector migration mapping reference
// ---------------------------------------------------------------------------

const FLUENTD_MIGRATION_MAP = `## FluentD → Vector Component Mapping

| FluentD Plugin | Vector Component | Kind | Notes |
|---------------|-----------------|------|-------|
| tail | file (source) | source | path→include, tag preserved |
| forward | vector (source) | source | Fluent forward protocol |
| syslog | syslog (source) | source | Direct mapping |
| http | http_server (source) | source | Note: http_server not http |
| tcp/udp | socket (source) | source | mode: tcp/udp |
| s3 (input) | aws_s3 (source) | source | SQS-based, needs queue_url |
| monitor_agent | internal_metrics | source | Prometheus format |
| elasticsearch | elasticsearch (sink) | sink | endpoints as array |
| opensearch | elasticsearch (sink) | sink | Use api_version + opensearch_service_type |
| kafka/kafka2 | kafka (sink) | sink | bootstrap_servers |
| s3 (output) | aws_s3 (sink) | sink | bucket + key_prefix |
| file | file (sink) | sink | path with template |
| stdout | console (sink) | sink | encoding.codec: json |
| datadog | datadog_logs (sink) | sink | default_api_key |
| loki | loki (sink) | sink | labels mapping |
| splunk_hec | splunk_hec_logs (sink) | sink | endpoint + token |
| record_transformer | remap (transform) | transform | Use VRL |
| parser | remap (transform) | transform | parse_json!, parse_syslog!, etc. |
| grep | filter (transform) | transform | VRL condition |
| rewrite_tag_filter | route (transform) | transform | VRL conditions per route |
| copy | Multiple sinks | sink | Use multiple sinks with same input |

## Ruby Expression → VRL Patterns

| FluentD Ruby | VRL Equivalent |
|-------------|---------------|
| record["field"] | .field |
| record.dig("a","b","c") | .a.b.c |
| Time.now.utc.iso8601 | now() |
| Base64.decode64(value) | decode_base64!(value) |
| record.key?("field") | exists(.field) |
| record.delete("field") | del(.field) |
| value.to_i | to_int!(value) |
| value.to_f | to_float!(value) |
| value.downcase | downcase(value) |
| value.gsub(/pat/, "rep") | replace(value, r'pat', "rep") |
| JSON.parse(value) | parse_json!(value) |
| if cond; expr; end | if condition { expr } |
| value.instance_of?(String) | is_string(value) |

## FluentD Event Routing Model

FluentD processes events through a tag-based pipeline:
1. **Source** emits events with a tag (e.g., tag auth0_log)
2. **Filters** are processed IN CONFIG FILE ORDER — each filter applies if its tag pattern matches the event tag (including glob patterns like auth0.**)
3. **Match** blocks catch events by tag pattern — the FIRST matching match consumes the event
4. **rewrite_tag_filter** is a special match plugin that re-emits events with NEW tags. Re-emitted events flow back through all filters from the top, then hit the next matching match block.
5. **copy** match plugin sends events to multiple outputs (<store> blocks)
6. **Labels** (@label) create isolated routing scopes — events routed to a label only see filters/matches inside that label

When translating to Vector:
- rewrite_tag_filter → Vector "route" transform with VRL conditions per output
- Filters in config order for the same tag → chain of Vector transforms with sequential inputs
- copy with multiple stores → multiple Vector sinks reading from the same transform
- The "inputs" field in Vector replaces FluentD's tag-based routing`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the Vector component reference for a specific component type.
 * Useful for targeted prompts (e.g., migration translation of a single block).
 */
export function getComponentReference(
  componentType: string,
  kind: "source" | "transform" | "sink",
): string | null {
  const map = kind === "source" ? SOURCES : kind === "transform" ? TRANSFORMS : SINKS;
  return map[componentType] ?? null;
}

/**
 * Returns the full Vector docs reference block for AI prompts.
 * Memoized — safe to call repeatedly.
 */
let _vectorDocsCache: string | null = null;

export function buildVectorDocsBlock(): string {
  if (_vectorDocsCache !== null) return _vectorDocsCache;

  const parts: string[] = [
    "=== Vector Component Configuration Reference ===",
    "",
    "## Sources (data inputs)",
    "",
  ];

  for (const [name, config] of Object.entries(SOURCES)) {
    parts.push(`### ${name}`, "```yaml", config, "```", "");
  }

  parts.push("## Transforms (data processing)", "");

  for (const [name, config] of Object.entries(TRANSFORMS)) {
    parts.push(`### ${name}`, "```yaml", config, "```", "");
  }

  parts.push("## Sinks (data outputs)", "");

  for (const [name, config] of Object.entries(SINKS)) {
    parts.push(`### ${name}`, "```yaml", config, "```", "");
  }

  _vectorDocsCache = parts.join("\n");
  return _vectorDocsCache;
}

/**
 * Returns the FluentD → Vector migration mapping reference.
 * Used by migration AI translator and any migration-related prompts.
 */
export function buildMigrationMappingBlock(): string {
  return FLUENTD_MIGRATION_MAP;
}

/**
 * Returns a focused reference for a specific component type.
 * Smaller than the full docs block — use when the target component is known.
 */
export function buildComponentDocsBlock(
  componentType: string,
  kind: "source" | "transform" | "sink",
): string {
  const ref = getComponentReference(componentType, kind);
  if (!ref) return "";
  return `=== Vector ${kind}: ${componentType} ===\n\`\`\`yaml\n${ref}\n\`\`\``;
}
