import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  authBasicBearerSchema,
} from "../shared";

export const metricsSinks: VectorComponentDef[] = [
  {
    type: "prometheus_exporter",
    kind: "sink",
    displayName: "Prometheus Exporter",
    description: "Expose metric events as a Prometheus scrape endpoint",
    category: "Observability",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Gauge",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            "Address to expose the Prometheus endpoint on (e.g., 0.0.0.0:9598)",
        },
        default_namespace: {
          type: "string",
          description: "Default namespace for metrics without one",
        },
        flush_period_secs: {
          type: "number",
          description: "How often to flush expired metrics in seconds",
        },
        suppress_timestamp: {
          type: "boolean",
          description: "Suppress timestamp in Prometheus output (default: false)",
        },
        distributions_as_summaries: {
          type: "boolean",
          description: "Convert distributions to summaries (default: false)",
        },
        buckets: {
          type: "array",
          items: { type: "number" },
          description: "Default histogram bucket boundaries",
        },
        ...tlsSchema(),
      },
      required: [],
    },
  },
  {
    type: "prometheus_remote_write",
    kind: "sink",
    displayName: "Prometheus Remote Write",
    description: "Send metrics via Prometheus remote write protocol",
    category: "Observability",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Gauge",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Remote write endpoint URL",
        },
        default_namespace: {
          type: "string",
          description: "Default namespace for metrics without one",
        },
        buckets: {
          type: "array",
          items: { type: "number" },
          description: "Default histogram bucket boundaries",
        },
        tenant_id: {
          type: "string",
          description: "Tenant ID for multi-tenant remote write endpoints",
        },
        ...authBasicBearerSchema(),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint"],
    },
  },
  {
    type: "statsd",
    kind: "sink",
    displayName: "StatsD",
    description: "Send metrics to a StatsD-compatible server",
    category: "Observability",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["tcp", "udp", "unix"],
          description: "Connection mode (default: udp)",
        },
        address: {
          type: "string",
          description: "StatsD server address (default: 127.0.0.1:8125)",
        },
        default_namespace: {
          type: "string",
          description: "Default namespace prefix for metrics",
        },
        ...bufferSchema(),
      },
      required: [],
    },
  },
];
