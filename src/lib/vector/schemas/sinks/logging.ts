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
          description: "The base URL of the Loki instance (e.g., http://localhost:3100)",
        },
        path: {
          type: "string",
          description:
            "The path to use in the URL of the Loki instance",
          default: "/loki/api/v1/push",
        },
        tenant_id: {
          type: "string",
          description: "Loki tenant ID for multi-tenancy",
        },
        labels: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Labels attached to each batch of events. Both keys and values are templateable",
        },
        structured_metadata: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Structured metadata attached to each batch of events (template-enabled)",
        },
        remove_label_fields: {
          type: "boolean",
          description: "Remove fields used as labels from events",
          default: false,
        },
        remove_timestamp: {
          type: "boolean",
          description:
            "Remove timestamp from the event payload while preserving it for Loki indexing",
          default: true,
        },
        out_of_order_action: {
          type: "string",
          enum: ["accept", "drop", "rewrite_timestamp"],
          description:
            "How to handle events with out-of-order timestamps",
          default: "accept",
        },
        ...encodingSchema([
          "avro",
          "cef",
          "csv",
          "gelf",
          "json",
          "logfmt",
          "native",
          "native_json",
          "otlp",
          "protobuf",
          "raw_message",
          "syslog",
          "text",
        ]),
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "snappy",
        ),
        ...authBasicBearerSchema(),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "encoding"],
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
          description:
            "The TCP endpoint to send logs to (e.g., logs.papertrailapp.com:12345)",
        },
        process: {
          type: "string",
          description:
            "The value to use as the process in Papertrail (template-enabled)",
          default: "vector",
        },
        keepalive: {
          type: "object",
          properties: {
            time_secs: {
              type: "number",
              description:
                "Time in seconds to wait before sending TCP keepalive probes on an idle connection",
            },
          },
          description: "TCP keepalive settings",
        },
        ...encodingSchema([
          "avro",
          "cef",
          "csv",
          "gelf",
          "json",
          "logfmt",
          "native",
          "native_json",
          "otlp",
          "protobuf",
          "raw_message",
          "syslog",
          "text",
        ]),
        ...tlsSchema(),
        ...bufferSchema(),
      },
      required: ["endpoint", "encoding"],
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
          description:
            "The base URL of the Splunk instance. The scheme (http or https) must be specified. No path should be included.",
        },
        default_token: {
          type: "string",
          description:
            "Default Splunk HEC token. If an event has a token set in its metadata, it prevails over this one.",
          sensitive: true,
        },
        endpoint_target: {
          type: "string",
          enum: ["event", "raw"],
          description:
            "Splunk HEC endpoint to send events to. 'event' sends metadata directly; 'raw' sends metadata as query parameters.",
          default: "event",
        },
        index: {
          type: "string",
          description:
            "Splunk index name. If not specified, the default index defined within Splunk is used (template-enabled).",
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
          description:
            "Overrides the name of the log field used to retrieve the hostname to send to Splunk HEC",
        },
        indexed_fields: {
          type: "array",
          items: { type: "string" },
          description: "Fields to be added to Splunk index",
        },
        auto_extract_timestamp: {
          type: "boolean",
          description:
            "Let Splunk extract timestamp from event text. Only relevant for Splunk v8.x+ when endpoint_target is 'event'.",
        },
        timestamp_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to retrieve the timestamp. Set to empty string to omit timestamp.",
        },
        ...encodingSchema([
          "avro",
          "cef",
          "csv",
          "gelf",
          "json",
          "logfmt",
          "native",
          "native_json",
          "otlp",
          "protobuf",
          "raw_message",
          "syslog",
          "text",
        ]),
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "none",
        ),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "default_token", "encoding"],
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
          description:
            "The base URL of the Splunk instance. The scheme (http or https) must be specified. No path should be included.",
        },
        default_token: {
          type: "string",
          description:
            "Default Splunk HEC token. If an event has a token set in its metadata, it prevails over this one.",
          sensitive: true,
        },
        index: {
          type: "string",
          description:
            "Splunk index name. If not specified, the default index defined within Splunk is used (template-enabled).",
        },
        source: {
          type: "string",
          description: "The source value to include in the events (template-enabled)",
        },
        sourcetype: {
          type: "string",
          description: "The sourcetype value to include in the events (template-enabled)",
        },
        host_key: {
          type: "string",
          description:
            "Overrides the name of the log field used to retrieve the hostname to send to Splunk HEC",
          default: "host",
        },
        default_namespace: {
          type: "string",
          description:
            "Sets the default namespace for any metrics sent. Only used if a metric has no existing namespace.",
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
      required: ["endpoint", "default_token"],
    },
  },
];
