import type { VectorComponentDef } from "../../types";
import {
  tlsSchema,
  batchSchema,
  bufferSchema,
  requestSchema,
  encodingSchema,
  compressionSchema,
  authElasticsearchSchema,
  authBasicBearerSchema,
} from "../shared";

export const searchDbSinks: VectorComponentDef[] = [
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
        api_version: {
          type: "string",
          enum: ["auto", "v6", "v7", "v8"],
          description: "Elasticsearch API version (default: auto)",
        },
        mode: {
          type: "string",
          enum: ["bulk", "data_stream"],
          description: "Indexing mode (default: bulk)",
        },
        bulk: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["index", "create", "update"],
              description: "Bulk action type (default: index)",
            },
            index: {
              type: "string",
              description: "Index name template (default: vector-%Y.%m.%d)",
            },
          },
          description: "Bulk API configuration",
        },
        data_stream: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Data stream type (default: logs)",
            },
            dataset: {
              type: "string",
              description: "Data stream dataset (template-enabled)",
            },
            namespace: {
              type: "string",
              description: "Data stream namespace (default: default)",
            },
          },
          description: "Data stream configuration",
        },
        pipeline: {
          type: "string",
          description: "Ingest pipeline name",
        },
        id_key: {
          type: "string",
          description: "Field for the document _id",
        },
        ...authElasticsearchSchema(),
        ...compressionSchema(["none", "gzip", "snappy", "zlib", "zstd"]),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoints"],
    },
  },
  {
    type: "clickhouse",
    kind: "sink",
    displayName: "ClickHouse",
    description: "Send log events to a ClickHouse database",
    category: "Database",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Database",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "ClickHouse HTTP endpoint (e.g., http://localhost:8123)",
        },
        database: {
          type: "string",
          description: "Target database name",
        },
        table: {
          type: "string",
          description: "Target table name",
        },
        skip_unknown_fields: {
          type: "boolean",
          description: "Skip fields not in the table schema (default: false)",
        },
        date_time_best_effort: {
          type: "boolean",
          description: "Use best-effort date time parsing (default: false)",
        },
        ...authBasicBearerSchema(),
        ...compressionSchema(["gzip", "none", "zstd"], "gzip"),
        ...encodingSchema(["json", "ndjson"]),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "table"],
    },
  },
  {
    type: "greptimedb_logs",
    kind: "sink",
    displayName: "GreptimeDB Logs",
    description: "Send log events to GreptimeDB via pipeline ingestion",
    category: "Database",
    status: "beta",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Database",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "GreptimeDB HTTP endpoint",
        },
        dbname: {
          type: "string",
          description: "Database name (default: public)",
        },
        table: {
          type: "string",
          description: "Target table name (template-enabled)",
        },
        pipeline_name: {
          type: "string",
          description: "Pipeline name for log transformation",
        },
        ...authBasicBearerSchema(),
        ...compressionSchema(["gzip", "none", "zstd"], "none"),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint"],
    },
  },
  {
    type: "greptimedb_metrics",
    kind: "sink",
    displayName: "GreptimeDB Metrics",
    description: "Send metric events to GreptimeDB",
    category: "Database",
    status: "beta",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Database",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "GreptimeDB gRPC endpoint",
        },
        dbname: {
          type: "string",
          description: "Database name (default: public)",
        },
        ...authBasicBearerSchema(),
        ...tlsSchema(),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint"],
    },
  },
  {
    type: "databend",
    kind: "sink",
    displayName: "Databend",
    description: "Send log events to Databend database",
    category: "Database",
    status: "beta",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Database",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Databend HTTP handler endpoint",
        },
        database: {
          type: "string",
          description: "Target database name",
        },
        table: {
          type: "string",
          description: "Target table name",
        },
        ...authBasicBearerSchema(),
        ...encodingSchema(["json", "csv"]),
        ...compressionSchema(["gzip", "none"], "none"),
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "table"],
    },
  },
  {
    type: "influxdb_logs",
    kind: "sink",
    displayName: "InfluxDB Logs",
    description: "Send log events to InfluxDB",
    category: "Database",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Database",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "InfluxDB endpoint URL",
        },
        org: {
          type: "string",
          description: "InfluxDB organization",
        },
        bucket: {
          type: "string",
          description: "InfluxDB bucket name",
        },
        token: {
          type: "string",
          description: "InfluxDB authentication token",
          sensitive: true,
        },
        measurement: {
          type: "string",
          description: "Measurement name for log events",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Fields to use as tags",
        },
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "bucket"],
    },
  },
  {
    type: "influxdb_metrics",
    kind: "sink",
    displayName: "InfluxDB Metrics",
    description: "Send metric events to InfluxDB",
    category: "Database",
    inputTypes: ["metric"],
    outputTypes: ["metric"],
    icon: "Database",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "InfluxDB endpoint URL",
        },
        org: {
          type: "string",
          description: "InfluxDB organization",
        },
        bucket: {
          type: "string",
          description: "InfluxDB bucket name",
        },
        token: {
          type: "string",
          description: "InfluxDB authentication token",
          sensitive: true,
        },
        default_namespace: {
          type: "string",
          description: "Default metric namespace",
        },
        tags: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Additional tags for all metrics",
        },
        ...tlsSchema(),
        ...batchSchema({ max_bytes: "1MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "bucket"],
    },
  },
  {
    type: "postgres",
    kind: "sink",
    displayName: "PostgreSQL",
    description: "Send log events to a PostgreSQL database",
    category: "Database",
    status: "beta",
    inputTypes: ["log"],
    outputTypes: ["log"],
    icon: "Database",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "PostgreSQL connection string (e.g., postgresql://user:pass@localhost:5432/db)",
        },
        table: {
          type: "string",
          description: "Target table name",
        },
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
      },
      required: ["endpoint", "table"],
    },
  },
];
