import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  compressionSchema,
  datadogCommonSchema,
} from "../shared";

export const datadogSinks: VectorComponentDef[] = [
  {
    type: "datadog_logs",
    kind: "sink",
    displayName: "Datadog Logs",
    description: "Send log events to Datadog",
    category: "Observability",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        ...datadogCommonSchema(),
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "none",
        ),
        encoding: {
          type: "object",
          properties: {
            timestamp_format: {
              type: "string",
              enum: [
                "rfc3339",
                "unix",
                "unix_float",
                "unix_ms",
                "unix_ns",
                "unix_us",
              ],
              description: "Format used for timestamp fields.",
            },
            except_fields: {
              type: "array",
              items: { type: "string" },
              description:
                "List of fields that are excluded from the encoded event.",
            },
            only_fields: {
              type: "array",
              items: { type: "string" },
              description:
                "List of fields that are included in the encoded event.",
            },
          },
          description: "Encoding configuration.",
        },
        conforms_as_agent: {
          type: "boolean",
          description:
            "Normalize events to conform to the Datadog Agent standard. Sends a DD-PROTOCOL: agent-json header.",
          default: false,
        },
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "4250000", timeout_secs: "5" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["default_api_key"],
    },
  },
  {
    type: "datadog_metrics",
    kind: "sink",
    displayName: "Datadog Metrics",
    description: "Send metric events to Datadog",
    category: "Observability",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        ...datadogCommonSchema(),
        default_namespace: {
          type: "string",
          description:
            "Sets the default namespace for any metrics sent. This namespace is only used if a metric has no existing namespace. When a namespace is present, it is used as a prefix to the metric name, separated with a period.",
        },
        ...tlsSchema(),
        ...batchSchema({ timeout_secs: "2" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["default_api_key"],
    },
  },
  {
    type: "datadog_events",
    kind: "sink",
    displayName: "Datadog Events",
    description: "Send events to the Datadog Events API",
    category: "Observability",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        ...datadogCommonSchema(),
        ...tlsSchema(),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["default_api_key"],
    },
  },
  {
    type: "datadog_traces",
    kind: "sink",
    displayName: "Datadog Traces",
    description: "Send trace events to Datadog APM",
    category: "Observability",
    inputTypes: ["trace"],
    outputTypes: ["trace"],
    icon: "Send",
    configSchema: {
      type: "object",
      properties: {
        ...datadogCommonSchema(),
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "none",
        ),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "3000000", timeout_secs: "10" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["default_api_key"],
    },
  },
];
