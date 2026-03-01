import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  authBasicBearerSchema,
  compressionSchema,
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
            "The address to expose for scraping. Metrics are served at /metrics.",
          default: "0.0.0.0:9598",
        },
        default_namespace: {
          type: "string",
          description:
            "Default namespace for metrics without one. Used as a prefix separated by an underscore.",
        },
        flush_period_secs: {
          type: "number",
          description:
            "Interval in seconds on which metrics are flushed. Metrics not seen since last flush are expired and removed.",
          default: 60,
        },
        suppress_timestamp: {
          type: "boolean",
          description:
            "Suppress timestamps on the Prometheus output. Useful when source timestamps are too far in the past.",
          default: false,
        },
        distributions_as_summaries: {
          type: "boolean",
          description:
            "Whether to render distributions as aggregated summaries instead of aggregated histograms.",
          default: false,
        },
        buckets: {
          type: "array",
          items: { type: "number" },
          description: "Default buckets for aggregating distribution metrics into histograms.",
          default: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        },
        quantiles: {
          type: "array",
          items: { type: "number" },
          description: "Quantiles for aggregating distribution metrics into summaries.",
          default: [0.5, 0.75, 0.9, 0.95, 0.99],
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
          description:
            "The endpoint URL to send data to, including scheme, host, and port.",
        },
        default_namespace: {
          type: "string",
          description:
            "Default namespace for metrics without one. Used as a prefix separated by an underscore.",
        },
        buckets: {
          type: "array",
          items: { type: "number" },
          description: "Default buckets for aggregating distribution metrics into histograms.",
          default: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        },
        quantiles: {
          type: "array",
          items: { type: "number" },
          description: "Quantiles for aggregating distribution metrics into summaries.",
          default: [0.5, 0.75, 0.9, 0.95, 0.99],
        },
        tenant_id: {
          type: "string",
          description:
            "The tenant ID to send via the X-Scope-OrgID header. Supports template syntax.",
        },
        ...authBasicBearerSchema(),
        ...compressionSchema(["none", "gzip", "snappy", "zlib", "zstd"], "snappy"),
        ...tlsSchema(),
        ...batchSchema({ timeout_secs: "1" }),
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
          description: "The type of socket to use for sending metrics.",
        },
        address: {
          type: "string",
          description:
            "The address to connect to. Must include a port. Required when mode is tcp or udp.",
        },
        path: {
          type: "string",
          description:
            "The unix socket path. Must be an absolute path. Required when mode is unix.",
        },
        default_namespace: {
          type: "string",
          description:
            "Default namespace prefix for metrics. Used as a prefix separated by a period.",
        },
        send_buffer_size: {
          type: "number",
          description: "The size of the socket's send buffer in bytes.",
        },
        unix_mode: {
          type: "string",
          enum: ["Datagram", "Stream"],
          description: "Unix socket mode. Only relevant when mode is unix.",
          default: "Stream",
        },
        ...batchSchema({ max_bytes: "1300", timeout_secs: "1" }),
        ...bufferSchema(),
        ...tlsSchema(),
      },
      required: ["mode"],
    },
  },
];
