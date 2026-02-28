import { findComponentDef } from "./catalog";
import type { VectorComponentDef } from "./types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TemplateNode {
  id: string;
  componentType: string;
  componentKey: string;
  kind: "source" | "transform" | "sink";
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
}

export interface TemplateEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort?: string;
}

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function findDef(type: string): VectorComponentDef | undefined {
  return findComponentDef(type);
}

function node(
  id: string,
  type: string,
  key: string,
  config: Record<string, unknown>,
  x: number,
  y: number,
): TemplateNode {
  const def = findDef(type);
  return {
    id,
    componentType: type,
    componentKey: key,
    kind: def?.kind ?? "source",
    config,
    positionX: x,
    positionY: y,
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  sourcePort?: string,
): TemplateEdge {
  return { id, sourceNodeId: source, targetNodeId: target, sourcePort };
}

/* ------------------------------------------------------------------ */
/*  Built-in Templates                                                 */
/* ------------------------------------------------------------------ */

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  // 1. Demo -> Console (Getting Started)
  {
    id: "builtin-demo-console",
    name: "Demo → Console",
    description:
      "Generate demo log events and print them to the console. Great for getting started and testing.",
    category: "Getting Started",
    nodes: [
      node("t1-n1", "demo_logs", "demo_logs", { format: "json", interval: 1 }, 100, 200),
      node("t1-n2", "console", "console", { encoding: { codec: "json" } }, 500, 200),
    ],
    edges: [edge("t1-e1", "t1-n1", "t1-n2")],
  },

  // 2. File -> Elasticsearch (Logging)
  {
    id: "builtin-file-elasticsearch",
    name: "File → Elasticsearch",
    description:
      "Collect logs from files, transform them with VRL, and send to Elasticsearch for search and analysis.",
    category: "Logging",
    nodes: [
      node(
        "t2-n1",
        "file",
        "file_source",
        { include: ["/var/log/**/*.log"] },
        100,
        200,
      ),
      node(
        "t2-n2",
        "remap",
        "parse_logs",
        { source: '. = parse_syslog!(.message)', drop_on_error: true },
        400,
        200,
      ),
      node(
        "t2-n3",
        "elasticsearch",
        "elasticsearch",
        { endpoints: ["http://localhost:9200"], index: "logs-%Y-%m-%d" },
        700,
        200,
      ),
    ],
    edges: [
      edge("t2-e1", "t2-n1", "t2-n2"),
      edge("t2-e2", "t2-n2", "t2-n3"),
    ],
  },

  // 3. Syslog -> S3 (Archival)
  {
    id: "builtin-syslog-s3",
    name: "Syslog → S3",
    description:
      "Receive syslog messages, enrich them with VRL, and archive to Amazon S3 for long-term storage.",
    category: "Archival",
    nodes: [
      node(
        "t3-n1",
        "syslog",
        "syslog_source",
        { address: "0.0.0.0:514", mode: "tcp" },
        100,
        200,
      ),
      node(
        "t3-n2",
        "remap",
        "enrich_syslog",
        { source: '.environment = "production"', drop_on_error: false },
        400,
        200,
      ),
      node(
        "t3-n3",
        "aws_s3",
        "s3_archive",
        {
          bucket: "my-log-archive",
          key_prefix: "syslog/%Y/%m/%d/",
          region: "us-east-1",
          encoding: { codec: "ndjson" },
        },
        700,
        200,
      ),
    ],
    edges: [
      edge("t3-e1", "t3-n1", "t3-n2"),
      edge("t3-e2", "t3-n2", "t3-n3"),
    ],
  },

  // 4. Kafka -> Elasticsearch (Streaming)
  {
    id: "builtin-kafka-elasticsearch",
    name: "Kafka → Elasticsearch",
    description:
      "Consume events from Kafka, transform and filter with VRL, then index into Elasticsearch.",
    category: "Streaming",
    nodes: [
      node(
        "t4-n1",
        "kafka",
        "kafka_source",
        {
          bootstrap_servers: "localhost:9092",
          topics: ["app-events"],
          group_id: "vectorflow",
          auto_offset_reset: "latest",
        },
        100,
        200,
      ),
      node(
        "t4-n2",
        "remap",
        "parse_events",
        { source: '. = parse_json!(.message)', drop_on_error: true },
        350,
        200,
      ),
      node(
        "t4-n3",
        "filter",
        "drop_debug",
        { condition: '.level != "debug"' },
        600,
        200,
      ),
      node(
        "t4-n4",
        "elasticsearch",
        "elasticsearch",
        { endpoints: ["http://localhost:9200"], index: "events-%Y-%m-%d" },
        850,
        200,
      ),
    ],
    edges: [
      edge("t4-e1", "t4-n1", "t4-n2"),
      edge("t4-e2", "t4-n2", "t4-n3"),
      edge("t4-e3", "t4-n3", "t4-n4"),
    ],
  },

  // 5. Host Metrics -> Datadog (Metrics)
  {
    id: "builtin-host-metrics-datadog",
    name: "Host Metrics → Datadog",
    description:
      "Collect system metrics from the host and forward them to Datadog for monitoring and alerting.",
    category: "Metrics",
    nodes: [
      node(
        "t5-n1",
        "host_metrics",
        "host_metrics",
        {
          collectors: ["cpu", "memory", "disk", "network"],
          scrape_interval_secs: 15,
        },
        100,
        200,
      ),
      node(
        "t5-n2",
        "datadog_logs",
        "datadog_metrics",
        {
          default_api_key: "${DATADOG_API_KEY}",
          site: "datadoghq.com",
        },
        500,
        200,
      ),
    ],
    edges: [edge("t5-e1", "t5-n1", "t5-n2")],
  },
];
