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
          description: "Elasticsearch API version",
          default: "auto",
        },
        mode: {
          type: "string",
          enum: ["bulk", "data_stream"],
          description: "Indexing mode",
          default: "bulk",
        },
        doc_type: {
          type: "string",
          description: "Document type for Elasticsearch indexing (ES 6.x and below)",
          default: "_doc",
        },
        opensearch_service_type: {
          type: "string",
          enum: ["managed", "serverless"],
          description: "Type of OpenSearch service",
          default: "managed",
        },
        healthcheck: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
              description:
                "Whether to check the health of the sink when Vector starts up",
              default: true,
            },
          },
          description: "Healthcheck configuration",
        },
        distribution: {
          type: "object",
          properties: {
            retry_initial_backoff_secs: {
              type: "number",
              description: "Initial backoff in seconds for endpoint retries",
              default: 1,
            },
            retry_max_duration_secs: {
              type: "number",
              description: "Max total retry duration in seconds",
              default: 3600,
            },
          },
          description: "Distribution/retry configuration for multi-node clusters",
        },
        bulk: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description:
                "Bulk action type (supports template syntax)",
              default: "index",
            },
            index: {
              type: "string",
              description:
                "Index name (supports template syntax)",
              default: "vector-%Y.%m.%d",
            },
            version: {
              type: "string",
              description:
                "Version field value for the bulk action (supports template syntax)",
            },
            version_type: {
              type: "string",
              enum: ["internal", "external", "external_gte"],
              description: "Version type for bulk operations",
              default: "internal",
            },
          },
          description: "Bulk API configuration",
        },
        data_stream: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description:
                "Data stream type (supports template syntax)",
              default: "logs",
            },
            dataset: {
              type: "string",
              description:
                "Data stream dataset (supports template syntax)",
              default: "generic",
            },
            namespace: {
              type: "string",
              description:
                "Data stream namespace (supports template syntax)",
              default: "default",
            },
            auto_routing: {
              type: "boolean",
              description:
                "Automatically route data to data streams based on event fields",
              default: true,
            },
            sync_fields: {
              type: "boolean",
              description:
                "Automatically add and sync data_stream.* fields in events",
              default: true,
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
          description:
            "The name of the event key that should map to Elasticsearch's _id field",
        },
        query: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Custom query string parameters to include in requests",
        },
        request_retry_partial: {
          type: "boolean",
          description: "Retry partially failed bulk requests",
          default: false,
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
          description:
            "The database that contains the target table (supports template syntax)",
        },
        table: {
          type: "string",
          description: "Target table name (supports template syntax)",
        },
        format: {
          type: "string",
          enum: ["arrow_stream", "json_as_object", "json_as_string", "json_each_row"],
          description: "Data format for parsing input data",
          default: "json_each_row",
        },
        skip_unknown_fields: {
          type: "boolean",
          description:
            "Sets input_format_skip_unknown_fields, allowing ClickHouse to discard fields not in the table schema",
        },
        date_time_best_effort: {
          type: "boolean",
          description:
            "Sets date_time_input_format to best_effort, allowing ClickHouse to properly parse RFC3339/ISO 8601",
          default: false,
        },
        insert_random_shard: {
          type: "boolean",
          description:
            "Sets insert_distributed_one_random_shard for Distributed Table Engine",
          default: false,
        },
        encoding: {
          type: "object",
          properties: {
            except_fields: {
              type: "array",
              items: { type: "string" },
              description: "Fields to exclude from the encoded event",
            },
            only_fields: {
              type: "array",
              items: { type: "string" },
              description: "Fields to include in the encoded event",
            },
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
              description: "Format used for timestamp fields",
            },
          },
          description: "Encoding configuration",
        },
        auth: {
          type: "object",
          properties: {
            strategy: {
              type: "string",
              enum: ["basic", "bearer", "aws"],
              description: "Authentication strategy",
            },
            user: {
              type: "string",
              description: "Basic auth username",
              dependsOn: { field: "strategy", value: "basic" },
            },
            password: {
              type: "string",
              description: "Basic auth password",
              sensitive: true,
              dependsOn: { field: "strategy", value: "basic" },
            },
            token: {
              type: "string",
              description: "Bearer token value",
              sensitive: true,
              dependsOn: { field: "strategy", value: "bearer" },
            },
          },
          description: "Authentication configuration",
        },
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "gzip",
        ),
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
          description: "GreptimeDB HTTP endpoint (e.g., http://localhost:4000)",
        },
        dbname: {
          type: "string",
          description: "GreptimeDB database name (supports template syntax)",
          default: "public",
        },
        table: {
          type: "string",
          description: "Target table name (supports template syntax)",
        },
        pipeline_name: {
          type: "string",
          description: "Pipeline name for log transformation (supports template syntax)",
          default: "greptime_identity",
        },
        pipeline_version: {
          type: "string",
          description: "Pipeline version identifier (supports template syntax)",
        },
        username: {
          type: "string",
          description: "Authentication username",
        },
        password: {
          type: "string",
          description: "Authentication password",
          sensitive: true,
        },
        ...compressionSchema(
          ["gzip", "none", "snappy", "zlib", "zstd"],
          "gzip",
        ),
        ...tlsSchema(),
        ...batchSchema({ timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "table"],
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
          description: "GreptimeDB database name",
          default: "public",
        },
        new_naming: {
          type: "boolean",
          description:
            "Use GreptimeDB's prefixed naming convention for metrics",
          default: false,
        },
        grpc_compression: {
          type: "string",
          enum: ["gzip", "zstd"],
          description: "gRPC compression encoding",
        },
        username: {
          type: "string",
          description: "Authentication username",
        },
        password: {
          type: "string",
          description: "Authentication password",
          sensitive: true,
        },
        ...tlsSchema(),
        ...batchSchema({ timeout_secs: "1" }),
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
          description:
            "Databend DSN connection string (e.g., databend://localhost:8000/default?sslmode=disable)",
        },
        database: {
          type: "string",
          description: "Target database name (overrides database in DSN)",
        },
        table: {
          type: "string",
          description: "Target table name",
        },
        missing_field_as: {
          type: "string",
          enum: ["ERROR", "FIELD_DEFAULT", "NULL", "TYPE_DEFAULT"],
          description: "How to handle missing fields in NDJson format",
          default: "NULL",
        },
        ...authBasicBearerSchema(),
        ...encodingSchema(["avro", "cef", "csv", "gelf", "json", "logfmt", "native", "native_json", "otlp", "protobuf", "raw_message", "syslog", "text"]),
        ...compressionSchema(["gzip", "none", "snappy", "zlib", "zstd"], "none"),
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
          description: "InfluxDB endpoint URL (e.g., http://localhost:8086)",
        },
        org: {
          type: "string",
          description:
            "InfluxDB organization name (only relevant for InfluxDB v2.x and above)",
        },
        bucket: {
          type: "string",
          description:
            "InfluxDB bucket name (only relevant for InfluxDB v2.x and above)",
        },
        database: {
          type: "string",
          description:
            "InfluxDB database name (only relevant for InfluxDB v0.x/v1.x)",
        },
        consistency: {
          type: "string",
          enum: ["any", "one", "quorum", "all"],
          description:
            "Write consistency level (only relevant for InfluxDB v0.x/v1.x)",
        },
        retention_policy_name: {
          type: "string",
          description:
            "Retention policy name (only relevant for InfluxDB v0.x/v1.x)",
        },
        token: {
          type: "string",
          description:
            "InfluxDB authentication token (only relevant for InfluxDB v2.x and above)",
          sensitive: true,
        },
        username: {
          type: "string",
          description:
            "InfluxDB username (only relevant for InfluxDB v0.x/v1.x)",
        },
        password: {
          type: "string",
          description:
            "InfluxDB password (only relevant for InfluxDB v0.x/v1.x)",
          sensitive: true,
        },
        measurement: {
          type: "string",
          description: "Measurement name for log events",
        },
        host_key: {
          type: "string",
          description: "The key to use for extracting the hostname from the event",
        },
        message_key: {
          type: "string",
          description: "The key to use for extracting the message from the event",
        },
        source_type_key: {
          type: "string",
          description:
            "The key to use for extracting the source type from the event",
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
          description: "InfluxDB endpoint URL (e.g., http://localhost:8086)",
        },
        org: {
          type: "string",
          description:
            "InfluxDB organization name (only relevant for InfluxDB v2.x and above)",
        },
        bucket: {
          type: "string",
          description:
            "InfluxDB bucket name (only relevant for InfluxDB v2.x and above)",
        },
        database: {
          type: "string",
          description:
            "InfluxDB database name (only relevant for InfluxDB v0.x/v1.x)",
        },
        consistency: {
          type: "string",
          enum: ["any", "one", "quorum", "all"],
          description:
            "Write consistency level (only relevant for InfluxDB v0.x/v1.x)",
        },
        retention_policy_name: {
          type: "string",
          description:
            "Retention policy name (only relevant for InfluxDB v0.x/v1.x)",
        },
        token: {
          type: "string",
          description:
            "InfluxDB authentication token (only relevant for InfluxDB v2.x and above)",
          sensitive: true,
        },
        username: {
          type: "string",
          description:
            "InfluxDB username (only relevant for InfluxDB v0.x/v1.x)",
        },
        password: {
          type: "string",
          description:
            "InfluxDB password (only relevant for InfluxDB v0.x/v1.x)",
          sensitive: true,
        },
        default_namespace: {
          type: "string",
          description: "Default namespace for metrics that have no existing namespace",
        },
        quantiles: {
          type: "array",
          items: { type: "number" },
          description: "List of quantiles to calculate for distribution metrics",
          default: [0.5, 0.75, 0.9, 0.95, 0.99],
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
          description:
            "PostgreSQL connection string (e.g., postgresql://user:pass@localhost:5432/db)",
        },
        table: {
          type: "string",
          description: "Target table name",
        },
        pool_size: {
          type: "number",
          description: "PostgreSQL connection pool size",
          default: 5,
        },
        ...batchSchema({ max_bytes: "10MB", timeout_secs: "1" }),
        ...bufferSchema(),
        ...requestSchema(),
      },
      required: ["endpoint", "table"],
    },
  },
];
