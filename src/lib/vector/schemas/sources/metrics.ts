import type { VectorComponentDef } from "../../types";
import { tlsSchema, authAwsSchema, authBasicBearerSchema } from "../shared";

export const metricSources: VectorComponentDef[] = [
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
            enum: [
              "cpu",
              "disk",
              "filesystem",
              "load",
              "host",
              "memory",
              "network",
              "cgroups",
            ],
          },
          description: "List of metric collectors to enable",
        },
        scrape_interval_secs: {
          type: "number",
          description: "How often to collect metrics in seconds",
        },
        namespace: {
          type: "string",
          description: "Namespace for metric names (default: host)",
        },
      },
      required: [],
    },
  },
  {
    type: "internal_metrics",
    kind: "source",
    displayName: "Internal Metrics",
    description: "Collect Vector's own internal metrics",
    category: "System",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        scrape_interval_secs: {
          type: "number",
          description: "How often to collect internal metrics (default: 2)",
        },
        namespace: {
          type: "string",
          description: "Namespace for metric names (default: vector)",
        },
        tags: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Additional tags to add to all metrics",
        },
      },
      required: [],
    },
  },
  {
    type: "static_metrics",
    kind: "source",
    displayName: "Static Metrics",
    description: "Emit constant metric values on an interval",
    category: "Testing",
    status: "beta",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        interval_secs: {
          type: "number",
          description: "Emit interval in seconds (default: 1)",
        },
        metrics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Metric name" },
              kind: {
                type: "string",
                enum: ["incremental", "absolute"],
                description: "Metric kind",
              },
              type: {
                type: "string",
                enum: ["counter", "gauge"],
                description: "Metric type",
              },
              value: { type: "number", description: "Metric value" },
              tags: {
                type: "object",
                additionalProperties: { type: "string" },
                description: "Tags for this metric",
              },
            },
          },
          description: "List of static metric definitions",
        },
        namespace: {
          type: "string",
          description: "Global namespace prefix",
        },
      },
      required: ["metrics"],
    },
  },
  {
    type: "apache_metrics",
    kind: "source",
    displayName: "Apache Metrics",
    description: "Scrape metrics from Apache's mod_status module",
    category: "Metrics",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        endpoints: {
          type: "array",
          items: { type: "string" },
          description:
            "Apache mod_status endpoint URLs (e.g., http://localhost/server-status?auto)",
        },
        scrape_interval_secs: {
          type: "number",
          description: "Scrape interval in seconds (default: 15)",
        },
        namespace: {
          type: "string",
          description: "Namespace for metric names (default: apache)",
        },
      },
      required: ["endpoints"],
    },
  },
  {
    type: "nginx_metrics",
    kind: "source",
    displayName: "Nginx Metrics",
    description: "Scrape metrics from Nginx's stub_status module",
    category: "Metrics",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        endpoints: {
          type: "array",
          items: { type: "string" },
          description:
            "Nginx stub_status endpoint URLs (e.g., http://localhost/basic_status)",
        },
        scrape_interval_secs: {
          type: "number",
          description: "Scrape interval in seconds (default: 15)",
        },
        namespace: {
          type: "string",
          description: "Namespace for metric names (default: nginx)",
        },
        ...tlsSchema(),
        ...authBasicBearerSchema(),
      },
      required: ["endpoints"],
    },
  },
  {
    type: "mongodb_metrics",
    kind: "source",
    displayName: "MongoDB Metrics",
    description: "Collect metrics from a MongoDB instance",
    category: "Metrics",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        endpoints: {
          type: "array",
          items: { type: "string" },
          description:
            "MongoDB connection strings (e.g., mongodb://localhost:27017)",
        },
        scrape_interval_secs: {
          type: "number",
          description: "Scrape interval in seconds (default: 15)",
        },
        namespace: {
          type: "string",
          description: "Namespace for metric names (default: mongodb)",
        },
        ...tlsSchema(),
      },
      required: ["endpoints"],
    },
  },
  {
    type: "postgresql_metrics",
    kind: "source",
    displayName: "PostgreSQL Metrics",
    description: "Collect metrics from a PostgreSQL database",
    category: "Metrics",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        endpoints: {
          type: "array",
          items: { type: "string" },
          description:
            "PostgreSQL connection strings (e.g., postgresql://user:pass@localhost:5432/db)",
        },
        include_databases: {
          type: "array",
          items: { type: "string" },
          description: "Database names to include (default: all)",
        },
        exclude_databases: {
          type: "array",
          items: { type: "string" },
          description: "Database names to exclude",
        },
        scrape_interval_secs: {
          type: "number",
          description: "Scrape interval in seconds (default: 15)",
        },
        namespace: {
          type: "string",
          description: "Namespace for metric names (default: postgresql)",
        },
        ...tlsSchema(),
      },
      required: ["endpoints"],
    },
  },
  {
    type: "eventstoredb_metrics",
    kind: "source",
    displayName: "EventStoreDB Metrics",
    description: "Collect metrics from an EventStoreDB instance",
    category: "Metrics",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "EventStoreDB stats endpoint (default: https://localhost:2113/stats)",
        },
        scrape_interval_secs: {
          type: "number",
          description: "Scrape interval in seconds (default: 15)",
        },
        namespace: {
          type: "string",
          description: "Namespace for metric names (default: eventstoredb)",
        },
        default_namespace: {
          type: "string",
          description: "Default namespace prefix",
        },
        ...tlsSchema(),
      },
      required: [],
    },
  },
  {
    type: "aws_ecs_metrics",
    kind: "source",
    displayName: "AWS ECS Metrics",
    description: "Collect metrics from AWS ECS task metadata endpoint",
    category: "Metrics",
    outputTypes: ["metric"],
    icon: "Cloud",
    configSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "ECS metadata endpoint (auto-detected in ECS environment)",
        },
        version: {
          type: "string",
          enum: ["v2", "v3", "v4"],
          description: "ECS metadata endpoint version (default: v4)",
        },
        scrape_interval_secs: {
          type: "number",
          description: "Scrape interval in seconds (default: 15)",
        },
        namespace: {
          type: "string",
          description: "Namespace for metric names (default: awsecs)",
        },
      },
      required: [],
    },
  },
  {
    type: "prometheus_scrape",
    kind: "source",
    displayName: "Prometheus Scrape",
    description: "Scrape Prometheus metrics from HTTP endpoints",
    category: "Metrics",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        endpoints: {
          type: "array",
          items: { type: "string" },
          description: "Prometheus metrics endpoint URLs",
        },
        scrape_interval_secs: {
          type: "number",
          description: "Scrape interval in seconds (default: 15)",
        },
        instance_tag: {
          type: "string",
          description: "Tag name for the instance (default: instance)",
        },
        endpoint_tag: {
          type: "string",
          description: "Tag name for the endpoint (default: endpoint)",
        },
        honor_labels: {
          type: "boolean",
          description: "Honor labels from the scraped metrics (default: false)",
        },
        query: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Query parameters to add to scrape requests",
        },
        ...authBasicBearerSchema(),
        ...tlsSchema(),
      },
      required: ["endpoints"],
    },
  },
  {
    type: "prometheus_remote_write",
    kind: "source",
    displayName: "Prometheus Remote Write",
    description: "Receive metrics via Prometheus remote write protocol",
    category: "Metrics",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Address to listen on (default: 0.0.0.0:9090)",
        },
        ...authBasicBearerSchema(),
        ...tlsSchema(),
      },
      required: [],
    },
  },
  {
    type: "prometheus_pushgateway",
    kind: "source",
    displayName: "Prometheus Pushgateway",
    description: "Receive metrics pushed via the Prometheus Pushgateway protocol",
    category: "Metrics",
    status: "beta",
    outputTypes: ["metric"],
    icon: "Activity",
    configSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Address to listen on (default: 0.0.0.0:9091)",
        },
        ...tlsSchema(),
      },
      required: [],
    },
  },
];
