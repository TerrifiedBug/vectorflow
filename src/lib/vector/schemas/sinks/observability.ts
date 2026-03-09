import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  encodingSchema,
  compressionSchema,
} from "../shared";

export const observabilitySinks: VectorComponentDef[] = [
  {
    type: "new_relic",
    kind: "sink",
    displayName: "New Relic",
    description: "Send logs, metrics, or events to New Relic",
    category: "Observability",
    inputTypes: ["log", "metric"],
    outputTypes: ["log", "metric"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        license_key: {
          type: "string",
          description: "New Relic license key",
          sensitive: true,
        },
        account_id: {
          type: "string",
          description: "New Relic account ID",
        },
        api: {
          type: "string",
          enum: ["events", "logs", "metrics"],
          description: "New Relic API endpoint to use",
        },
        region: {
          type: "string",
          enum: ["us", "eu"],
          description: "New Relic region",
          default: "us",
        },
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "gzip",
        ),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["license_key", "account_id", "api"],
    },
  },
  {
    type: "honeycomb",
    kind: "sink",
    displayName: "Honeycomb",
    description: "Send log events to Honeycomb.io",
    category: "Observability",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        api_key: {
          type: "string",
          description: "Honeycomb API key",
          sensitive: true,
        },
        dataset: {
          type: "string",
          description: "Honeycomb dataset name",
        },
        endpoint: {
          type: "string",
          description:
            "Honeycomb API endpoint URL (default: https://api.honeycomb.io)",
          default: "https://api.honeycomb.io",
        },
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "zstd",
        ),
        ...batchSchema({ max_bytes: "100KB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["api_key", "dataset"],
    },
  },
  {
    type: "axiom",
    kind: "sink",
    displayName: "Axiom",
    description: "Send log events to Axiom",
    category: "Observability",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Axiom API token",
          sensitive: true,
        },
        dataset: {
          type: "string",
          description: "Axiom dataset name",
        },
        org_id: {
          type: "string",
          description:
            "Axiom organization ID (only required when using personal tokens)",
        },
        url: {
          type: "string",
          description: "Axiom API URL (default: https://api.axiom.co)",
          default: "https://api.axiom.co",
        },
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "zstd",
        ),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["token", "dataset"],
    },
  },
  {
    type: "appsignal",
    kind: "sink",
    displayName: "AppSignal",
    description: "Send logs and metrics to AppSignal",
    category: "Observability",
    inputTypes: ["log", "metric"],
    outputTypes: ["log", "metric"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        push_api_key: {
          type: "string",
          description: "AppSignal push API key",
          sensitive: true,
        },
        endpoint: {
          type: "string",
          description:
            "AppSignal API endpoint (default: https://appsignal-endpoint.net)",
          default: "https://appsignal-endpoint.net",
        },
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "gzip",
        ),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "450KB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["push_api_key"],
    },
  },
  {
    type: "mezmo",
    kind: "sink",
    displayName: "Mezmo",
    description: "Send log events to Mezmo (formerly LogDNA)",
    category: "Observability",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        api_key: {
          type: "string",
          description: "Mezmo ingestion API key",
          sensitive: true,
        },
        hostname: {
          type: "string",
          description: "Hostname to attach to each batch of events",
        },
        endpoint: {
          type: "string",
          description:
            "HTTP endpoint for log delivery (default: https://logs.mezmo.com/)",
          default: "https://logs.mezmo.com/",
        },
        default_app: {
          type: "string",
          description:
            "Default app name for events without a file or app field",
          default: "vector",
        },
        default_env: {
          type: "string",
          description: "Default environment for events without an env field",
          default: "production",
        },
        mac: {
          type: "string",
          description: "MAC address to attach to events",
        },
        ip: {
          type: "string",
          description: "IP address to attach to events",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to attach to events",
        },
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["api_key", "hostname"],
    },
  },
  {
    type: "sematext_logs",
    kind: "sink",
    displayName: "Sematext Logs",
    description: "Send log events to Sematext Cloud",
    category: "Observability",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Sematext application token",
          sensitive: true,
        },
        region: {
          type: "string",
          enum: ["us", "eu"],
          description: "Sematext region",
          default: "us",
        },
        endpoint: {
          type: "string",
          description:
            "Custom Sematext endpoint URL (overrides region setting)",
        },
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["token"],
    },
  },
  {
    type: "sematext_metrics",
    kind: "sink",
    displayName: "Sematext Metrics",
    description: "Send metric events to Sematext Cloud",
    category: "Observability",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Sematext application token",
          sensitive: true,
        },
        region: {
          type: "string",
          enum: ["us", "eu"],
          description: "Sematext region",
          default: "us",
        },
        default_namespace: {
          type: "string",
          description:
            "Default namespace for any metrics sent (used as prefix to metric names)",
        },
        endpoint: {
          type: "string",
          description:
            "Custom Sematext endpoint URL (overrides region setting)",
        },
        ...batchSchema({ timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["token", "default_namespace"],
    },
  },
  {
    type: "humio_logs",
    kind: "sink",
    displayName: "Humio Logs",
    description: "Send log events to Humio (CrowdStrike Falcon LogScale)",
    category: "Observability",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Humio ingest token",
          sensitive: true,
        },
        endpoint: {
          type: "string",
          description:
            "Humio endpoint URL (default: https://cloud.humio.com)",
          default: "https://cloud.humio.com",
        },
        source: {
          type: "string",
          description: "Event source value (template-enabled)",
        },
        event_type: {
          type: "string",
          description:
            "Event type used as the parser name in Humio (template-enabled)",
        },
        host_key: {
          type: "string",
          description:
            "Field for the host value (default: .host)",
          default: ".host",
        },
        index: {
          type: "string",
          description:
            "Optional repository name to ingest into (template-enabled)",
        },
        indexed_fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Event fields to be added to Humio's extra fields",
        },
        timestamp_key: {
          type: "string",
          description: "Field for the timestamp value (default: .timestamp)",
          default: ".timestamp",
        },
        timestamp_nanos_key: {
          type: "string",
          description:
            "Field for the nanosecond timestamp value (default: @timestamp.nanos)",
          default: "@timestamp.nanos",
        },
        ...encodingSchema(["avro", "cef", "csv", "gelf", "json", "logfmt", "native", "native_json", "otlp", "protobuf", "raw_message", "syslog", "text"]),
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "none",
        ),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["token", "encoding"],
    },
  },
  {
    type: "humio_metrics",
    kind: "sink",
    displayName: "Humio Metrics",
    description: "Send metric events to Humio (CrowdStrike Falcon LogScale)",
    category: "Observability",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Humio ingest token",
          sensitive: true,
        },
        endpoint: {
          type: "string",
          description:
            "Humio endpoint URL (default: https://cloud.humio.com)",
          default: "https://cloud.humio.com",
        },
        source: {
          type: "string",
          description: "Event source value (template-enabled)",
        },
        event_type: {
          type: "string",
          description:
            "Event type used as the parser name in Humio (template-enabled)",
        },
        host_key: {
          type: "string",
          description: "Field for the host value",
          default: "host",
        },
        host_tag: {
          type: "string",
          description:
            "Name of the tag in the metric to use for the source host",
        },
        index: {
          type: "string",
          description:
            "Optional repository name to ingest into (template-enabled)",
        },
        indexed_fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Event fields to be added to Humio's extra fields",
        },
        metric_tag_values: {
          type: "string",
          enum: ["full", "single"],
          description:
            "Controls how metric tag values are encoded (default: single)",
          default: "single",
        },
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "none",
        ),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["token"],
    },
  },
  {
    type: "keep",
    kind: "sink",
    displayName: "Keep",
    description: "Send alert events to Keep AIOps platform",
    category: "Observability",
    status: "beta",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        api_key: {
          type: "string",
          description: "Keep API key",
          sensitive: true,
        },
        endpoint: {
          type: "string",
          description: "Keep API endpoint URL",
          default:
            "http://localhost:8080/alerts/event/vectordev?provider_id=test",
        },
        ...batchSchema({ max_bytes: "100KB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["api_key"],
    },
  },
];
