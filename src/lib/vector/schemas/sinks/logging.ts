import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  encodingSchema,
  compressionSchema,
  authBasicBearerSchema,
} from "../shared";

export const loggingSinks: VectorComponentDef[] = [
  {
    type: "loki",
    kind: "sink",
    displayName: "Loki",
    description: "Send log events to Grafana Loki",
    category: "Observability",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "LinkIcon",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Loki endpoint URL (e.g., http://localhost:3100)",
        },
        path: {
          type: "string",
          description: "URL path appended to endpoint (default: /loki/api/v1/push)",
        },
        tenant_id: {
          type: "string",
          description: "Loki tenant ID for multi-tenancy",
        },
        labels: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Labels to attach to log streams (template-enabled)",
        },
        remove_label_fields: {
          type: "boolean",
          description: "Remove fields used as labels from events (default: false)",
        },
        remove_timestamp: {
          type: "boolean",
          description: "Remove timestamp from log line (default: true)",
        },
        out_of_order_action: {
          type: "string",
          enum: ["accept", "drop", "rewrite_timestamp"],
          description: "How to handle out-of-order events (default: accept)",
        },
        ...encodingSchema(["json", "text", "logfmt"]),
        ...compressionSchema(["snappy", "gzip", "none", "zlib", "zstd"], "snappy"),
        ...authBasicBearerSchema(),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint"],
    },
  },
  {
    type: "papertrail",
    kind: "sink",
    displayName: "Papertrail",
    description: "Send log events to Papertrail",
    category: "Observability",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Papertrail endpoint (e.g., logs.papertrailapp.com:12345)",
        },
        ...encodingSchema(["json", "text"]),
        ...tlsSchema(),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint"],
    },
  },
  {
    type: "splunk_hec_logs",
    kind: "sink",
    displayName: "Splunk HEC Logs",
    description: "Send log events to Splunk via HTTP Event Collector",
    category: "Observability",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Splunk HEC endpoint URL",
        },
        default_token: {
          type: "string",
          description: "Splunk HEC token",
          sensitive: true,
        },
        index: {
          type: "string",
          description: "Splunk index name (template-enabled)",
        },
        source: {
          type: "string",
          description: "Event source value (template-enabled)",
        },
        sourcetype: {
          type: "string",
          description: "Event sourcetype value (template-enabled)",
        },
        host_key: {
          type: "string",
          description: "Field to use as the host value",
        },
        indexed_fields: {
          type: "array",
          items: { type: "string" },
          description: "Fields to index in Splunk",
        },
        auto_extract_timestamp: {
          type: "boolean",
          description: "Let Splunk extract timestamp from event (default: false)",
        },
        timestamp_key: {
          type: "string",
          description: "Field containing the event timestamp",
        },
        ...encodingSchema(["json", "text"]),
        ...compressionSchema(["gzip", "none"], "none"),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "default_token"],
    },
  },
  {
    type: "splunk_hec_metrics",
    kind: "sink",
    displayName: "Splunk HEC Metrics",
    description: "Send metric events to Splunk via HTTP Event Collector",
    category: "Observability",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Splunk HEC endpoint URL",
        },
        default_token: {
          type: "string",
          description: "Splunk HEC token",
          sensitive: true,
        },
        index: {
          type: "string",
          description: "Splunk index name",
        },
        source: {
          type: "string",
          description: "Event source value",
        },
        sourcetype: {
          type: "string",
          description: "Event sourcetype value",
        },
        host_key: {
          type: "string",
          description: "Field to use as the host value",
        },
        default_namespace: {
          type: "string",
          description: "Default metric namespace",
        },
        ...compressionSchema(["gzip", "none"], "none"),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "default_token"],
    },
  },
];
