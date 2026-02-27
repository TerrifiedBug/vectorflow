import type { VectorComponentDef } from "./types";

export const VECTOR_CATALOG: VectorComponentDef[] = [
  // ── Sources ──────────────────────────────────────────────────────────
  {
    type: "file",
    kind: "source",
    displayName: "File",
    description: "Collect logs from files on disk",
    category: "Local",
    outputTypes: ["log"],
    icon: "FileText",
    configSchema: {
      type: "object",
      properties: {
        include: {
          type: "array",
          items: { type: "string" },
          description: "Array of file paths or globs to include",
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description: "Array of file paths or globs to exclude",
        },
        ignore_older_secs: {
          type: "number",
          description: "Ignore files older than this many seconds",
        },
      },
      required: ["include"],
    },
  },
  {
    type: "kafka",
    kind: "source",
    displayName: "Kafka",
    description: "Consume events from Apache Kafka topics",
    category: "Messaging",
    outputTypes: ["log"],
    icon: "Radio",
    configSchema: {
      type: "object",
      properties: {
        bootstrap_servers: {
          type: "string",
          description: "Comma-separated list of Kafka broker addresses",
        },
        group_id: {
          type: "string",
          description: "Consumer group ID",
        },
        topics: {
          type: "array",
          items: { type: "string" },
          description: "List of topics to consume from",
        },
        auto_offset_reset: {
          type: "string",
          enum: ["earliest", "latest"],
          description: "Where to start reading when no offset exists",
        },
      },
      required: ["bootstrap_servers", "topics"],
    },
  },
  {
    type: "syslog",
    kind: "source",
    displayName: "Syslog",
    description: "Receive syslog messages over TCP or UDP",
    category: "Network",
    outputTypes: ["log"],
    icon: "Globe",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The address to listen on (e.g., 0.0.0.0:514)",
        },
        mode: {
          type: "string",
          enum: ["tcp", "udp"],
          description: "Protocol to listen on",
        },
      },
      required: ["address"],
    },
  },
  {
    type: "http_server",
    kind: "source",
    displayName: "HTTP Server",
    description: "Receive events via HTTP requests",
    category: "Network",
    outputTypes: ["log"],
    icon: "Server",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The address to listen on (e.g., 0.0.0.0:8080)",
        },
        encoding: {
          type: "string",
          enum: ["text", "json", "ndjson", "binary"],
          description: "Expected encoding of incoming data",
        },
        path: {
          type: "string",
          description: "URL path to accept requests on",
        },
      },
      required: ["address"],
    },
  },
  {
    type: "demo_logs",
    kind: "source",
    displayName: "Demo Logs",
    description: "Generate fake log events for testing and demos",
    category: "Testing",
    outputTypes: ["log"],
    icon: "Play",
    configSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["syslog", "common", "json", "apache_common", "apache_error"],
          description: "Format of the generated logs",
        },
        interval: {
          type: "number",
          description: "Interval between events in seconds",
        },
        count: {
          type: "number",
          description: "Total number of events to generate (0 = unlimited)",
        },
      },
      required: [],
    },
  },
  {
    type: "host_metrics",
    kind: "source",
    displayName: "Host Metrics",
    description: "Collect system-level metrics from the host machine",
    category: "System",
    outputTypes: ["metric"],
    icon: "Cpu",
    configSchema: {
      type: "object",
      properties: {
        collectors: {
          type: "array",
          items: {
            type: "string",
            enum: ["cpu", "disk", "filesystem", "load", "host", "memory", "network"],
          },
          description: "List of metric collectors to enable",
        },
        scrape_interval_secs: {
          type: "number",
          description: "How often to collect metrics in seconds",
        },
      },
      required: [],
    },
  },

  // ── Transforms ───────────────────────────────────────────────────────
  {
    type: "remap",
    kind: "transform",
    displayName: "Remap (VRL)",
    description: "Transform events using Vector Remap Language",
    category: "General",
    inputTypes: ["log", "metric", "trace"],
    outputTypes: ["log", "metric", "trace"],
    icon: "Code",
    configSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "VRL program to execute on each event",
        },
        drop_on_error: {
          type: "boolean",
          description: "Drop events that cause a runtime error",
        },
        drop_on_abort: {
          type: "boolean",
          description: "Drop events that trigger an abort",
        },
      },
      required: ["source"],
    },
  },
  {
    type: "filter",
    kind: "transform",
    displayName: "Filter",
    description: "Conditionally drop events based on a VRL condition",
    category: "General",
    inputTypes: ["log", "metric", "trace"],
    outputTypes: ["log", "metric", "trace"],
    icon: "Filter",
    configSchema: {
      type: "object",
      properties: {
        condition: {
          type: "string",
          description: "VRL condition expression; events that evaluate to false are dropped",
        },
      },
      required: ["condition"],
    },
  },
  {
    type: "route",
    kind: "transform",
    displayName: "Route",
    description: "Conditionally route events to different outputs",
    category: "General",
    inputTypes: ["log", "metric", "trace"],
    outputTypes: ["log", "metric", "trace"],
    icon: "GitBranch",
    configSchema: {
      type: "object",
      properties: {
        route: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Map of output name to VRL condition",
        },
      },
      required: ["route"],
    },
  },
  {
    type: "sample",
    kind: "transform",
    displayName: "Sample",
    description: "Randomly sample a percentage of events",
    category: "General",
    inputTypes: ["log", "trace"],
    outputTypes: ["log", "trace"],
    icon: "Percent",
    configSchema: {
      type: "object",
      properties: {
        rate: {
          type: "number",
          description: "The rate at which events are kept (e.g., 10 keeps 1 in 10)",
        },
        key_field: {
          type: "string",
          description: "Field to use for consistent sampling",
        },
      },
      required: ["rate"],
    },
  },
  {
    type: "dedupe",
    kind: "transform",
    displayName: "Dedupe",
    description: "Deduplicate events based on a set of fields",
    category: "General",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Copy",
    configSchema: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          properties: {
            match: {
              type: "array",
              items: { type: "string" },
              description: "Fields to match for deduplication",
            },
          },
          description: "Field matching configuration",
        },
        cache: {
          type: "object",
          properties: {
            num_events: {
              type: "number",
              description: "Number of events to cache for dedup lookback",
            },
          },
          description: "Cache configuration",
        },
      },
      required: [],
    },
  },
  {
    type: "log_to_metric",
    kind: "transform",
    displayName: "Log to Metric",
    description: "Convert log events into metric events",
    category: "General",
    inputTypes: ["log"],
    outputTypes: ["metric"],
    icon: "BarChart",
    configSchema: {
      type: "object",
      properties: {
        metrics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["counter", "gauge", "histogram", "set", "summary"],
              },
              field: { type: "string" },
              name: { type: "string" },
            },
          },
          description: "List of metric definitions to derive from logs",
        },
      },
      required: ["metrics"],
    },
  },

  // ── Sinks ────────────────────────────────────────────────────────────
  {
    type: "elasticsearch",
    kind: "sink",
    displayName: "Elasticsearch",
    description: "Send events to an Elasticsearch cluster",
    category: "Search",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Database",
    configSchema: {
      type: "object",
      properties: {
        endpoints: {
          type: "array",
          items: { type: "string" },
          description: "List of Elasticsearch endpoint URLs",
        },
        index: {
          type: "string",
          description: "Index name or template to write events to",
        },
        bulk: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["index", "create"],
            },
          },
          description: "Bulk API configuration",
        },
      },
      required: ["endpoints"],
    },
  },
  {
    type: "aws_s3",
    kind: "sink",
    displayName: "AWS S3",
    description: "Archive events to Amazon S3 buckets",
    category: "Cloud",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        bucket: {
          type: "string",
          description: "S3 bucket name",
        },
        key_prefix: {
          type: "string",
          description: "Prefix for the S3 object keys",
        },
        region: {
          type: "string",
          description: "AWS region of the bucket",
        },
        encoding: {
          type: "object",
          properties: {
            codec: {
              type: "string",
              enum: ["json", "ndjson", "text", "native_json"],
            },
          },
          description: "Encoding configuration for the output",
        },
      },
      required: ["bucket"],
    },
  },
  {
    type: "console",
    kind: "sink",
    displayName: "Console",
    description: "Print events to stdout for debugging",
    category: "Debug",
    inputTypes: ["log", "metric", "trace"],
    outputTypes: ["log", "metric", "trace"],
    icon: "Terminal",
    configSchema: {
      type: "object",
      properties: {
        encoding: {
          type: "object",
          properties: {
            codec: {
              type: "string",
              enum: ["json", "text", "logfmt"],
            },
          },
          description: "Encoding format for output",
        },
      },
      required: [],
    },
  },
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
        default_api_key: {
          type: "string",
          description: "Datadog API key",
        },
        site: {
          type: "string",
          description: "Datadog site (e.g., datadoghq.com, datadoghq.eu)",
        },
        compression: {
          type: "string",
          enum: ["gzip", "none"],
          description: "Compression for outgoing requests",
        },
      },
      required: ["default_api_key"],
    },
  },
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
        labels: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Labels to attach to log streams",
        },
        encoding: {
          type: "object",
          properties: {
            codec: {
              type: "string",
              enum: ["json", "text", "logfmt"],
            },
          },
          description: "Encoding configuration",
        },
        tenant_id: {
          type: "string",
          description: "Loki tenant ID for multi-tenancy",
        },
      },
      required: ["endpoint"],
    },
  },
  {
    type: "http",
    kind: "sink",
    displayName: "HTTP",
    description: "Send events to an HTTP endpoint",
    category: "Network",
    inputTypes: ["log", "metric", "trace"],
    outputTypes: ["log", "metric", "trace"],
    icon: "Globe",
    configSchema: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "HTTP endpoint URI",
        },
        method: {
          type: "string",
          enum: ["post", "put"],
          description: "HTTP method to use",
        },
        encoding: {
          type: "object",
          properties: {
            codec: {
              type: "string",
              enum: ["json", "ndjson", "text"],
            },
          },
          description: "Encoding format for the payload",
        },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Additional HTTP headers",
        },
      },
      required: ["uri"],
    },
  },
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
          description: "Address to expose the Prometheus endpoint on (e.g., 0.0.0.0:9598)",
        },
        default_namespace: {
          type: "string",
          description: "Default namespace for metrics without one",
        },
        flush_period_secs: {
          type: "number",
          description: "How often to flush expired metrics in seconds",
        },
      },
      required: [],
    },
  },
];
