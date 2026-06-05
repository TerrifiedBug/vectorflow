import "dotenv/config";
import { PrismaClient, Prisma, type AlertCondition, type AlertMetric } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { QA_DEV_USER } from "../src/lib/dev-auth-bypass";
import { generateEnrollmentToken, generateNodeToken } from "../src/server/services/agent-token";
import { QA_IDS, resetQaSeed } from "../src/server/services/qa-seed";

function createPrismaClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed the QA dev environment.");
  }

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });

  return new PrismaClient({ adapter });
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

const ENVIRONMENTS = [
  {
    id: QA_IDS.environments[0],
    name: "production",
    costPerGbCents: 12,
    costBudgetCents: 250_000,
    createdAt: daysAgo(14),
  },
  {
    id: QA_IDS.environments[1],
    name: "staging",
    costPerGbCents: 8,
    costBudgetCents: null,
    createdAt: daysAgo(14),
  },
  {
    id: QA_IDS.environments[2],
    name: "development",
    costPerGbCents: 5,
    costBudgetCents: null,
    createdAt: daysAgo(14),
  },
] as const;

const VECTOR_NODES = [
  nodeDef(QA_IDS.vectorNodes[0], "vf-prod-edge-01", "vf-prod-edge-01.demo.internal", ENVIRONMENTS[0].id, "HEALTHY", "DOCKER", "linux", "0.1.4", "0.40.0", { role: "edge", env: "production", tier: "front" }, 12, 0.45),
  nodeDef(QA_IDS.vectorNodes[1], "vf-prod-edge-02", "vf-prod-edge-02.demo.internal", ENVIRONMENTS[0].id, "HEALTHY", "DOCKER", "linux", "0.1.4", "0.40.0", { role: "edge", env: "production", tier: "front" }, 12, 0.52),
  nodeDef(QA_IDS.vectorNodes[2], "vf-prod-edge-03", "vf-prod-edge-03.demo.internal", ENVIRONMENTS[0].id, "HEALTHY", "DOCKER", "linux", "0.1.4", "0.40.0", { role: "edge", env: "production", tier: "front" }, 11, 0.38),
  nodeDef(QA_IDS.vectorNodes[3], "vf-prod-aggregator-01", "vf-prod-aggregator-01.demo.internal", ENVIRONMENTS[0].id, "DEGRADED", "STANDALONE", "linux", "0.1.3", "0.39.0", { role: "aggregator", env: "production", tier: "core" }, 11, 0.78),
  nodeDef(QA_IDS.vectorNodes[4], "vf-prod-aggregator-02", "vf-prod-aggregator-02.demo.internal", ENVIRONMENTS[0].id, "HEALTHY", "STANDALONE", "linux", "0.1.4", "0.40.0", { role: "aggregator", env: "production", tier: "core" }, 10, 0.61),
  nodeDef(QA_IDS.vectorNodes[5], "vf-staging-01", "vf-staging-01.demo.internal", ENVIRONMENTS[1].id, "HEALTHY", "DOCKER", "linux", "0.1.4", "0.40.0", { role: "edge", env: "staging" }, 8, 0.31),
  nodeDef(QA_IDS.vectorNodes[6], "vf-staging-02", "vf-staging-02.demo.internal", ENVIRONMENTS[1].id, "HEALTHY", "DOCKER", "linux", "0.1.4", "0.40.0", { role: "edge", env: "staging" }, 8, 0.28),
  nodeDef(QA_IDS.vectorNodes[7], "vf-staging-03", "vf-staging-03.demo.internal", ENVIRONMENTS[1].id, "DEGRADED", "STANDALONE", "linux", "0.1.3", "0.39.0", { role: "aggregator", env: "staging" }, 7, 0.83),
  nodeDef(QA_IDS.vectorNodes[8], "vf-staging-04", "vf-staging-04.demo.internal", ENVIRONMENTS[1].id, "UNREACHABLE", "DOCKER", "linux", "0.1.3", "0.39.0", { role: "edge", env: "staging" }, 6, 0.18),
  nodeDef(QA_IDS.vectorNodes[9], "vf-dev-laptop", "vf-dev-laptop.demo.internal", ENVIRONMENTS[2].id, "HEALTHY", "DOCKER", "darwin", "0.1.4", "0.40.0", { role: "dev", env: "development" }, 5, 0.22),
  nodeDef(QA_IDS.vectorNodes[10], "vf-dev-canary", "vf-dev-canary.demo.internal", ENVIRONMENTS[2].id, "HEALTHY", "DOCKER", "linux", "0.1.5-rc1", "0.41.0-beta1", { role: "canary", env: "development" }, 4, 0.41),
  nodeDef(QA_IDS.vectorNodes[11], "vf-dev-arm", "vf-dev-arm.demo.internal", ENVIRONMENTS[2].id, "HEALTHY", "STANDALONE", "linux", "0.1.4", "0.40.0", { role: "dev", env: "development", arch: "arm64" }, 3, 0.19),
] as const;

const PIPELINES = [
  pipelineDef({
    id: QA_IDS.pipelines[0],
    short: "k8s",
    name: "k8s-logs-to-s3",
    description: "Kubernetes pod logs → JSON parse → S3 archive.",
    environmentId: ENVIRONMENTS[0].id,
    tags: ["platform", "ingest"],
    deployedDaysAgo: 11,
    baseEvents: 18_000,
    reduction: 0.12,
    errorRate: 0.002,
    bytesPerEvent: 320,
    statusRows: [
      statusRow(VECTOR_NODES[0].id, 4, "RUNNING", 18_000_000, 15_840_000, 36_000, 2_124_000, 5_760_000_000, 4_838_400_000, 0.45),
      statusRow(VECTOR_NODES[1].id, 4, "RUNNING", 17_500_000, 15_400_000, 35_000, 2_065_000, 5_600_000_000, 4_704_000_000, 0.52),
    ],
    nodes: [
      pipelineNode("src", "k8s_logs", "Pod logs", "kubernetes_logs", "SOURCE", {}, 100, 200),
      pipelineNode("trn", "parse_json", "Parse JSON", "remap", "TRANSFORM", { source: ". = parse_json!(.message)" }, 350, 200),
      pipelineNode("snk", "s3_archive", "S3 archive", "aws_s3", "SINK", { bucket: "demo-k8s-logs", region: "us-east-1", compression: "gzip", access_key: "SECRET[s3_archive_key]" }, 600, 200),
    ],
  }),
  pipelineDef({
    id: QA_IDS.pipelines[1],
    short: "auth",
    name: "auth-events-to-elastic",
    description: "Auth audit logs → enrich with geoip → Elasticsearch.",
    environmentId: ENVIRONMENTS[0].id,
    tags: ["security", "ingest"],
    deployedDaysAgo: 9,
    baseEvents: 4_200,
    reduction: 0.05,
    errorRate: 0.0005,
    bytesPerEvent: 540,
    statusRows: [
      statusRow(VECTOR_NODES[2].id, 2, "RUNNING", 4_200_000, 3_990_000, 2_100, 207_900, 2_268_000_000, 1_928_000_000, 0.38),
    ],
    nodes: [
      pipelineNode("src", "auth_http", "Auth webhook", "http_server", "SOURCE", { address: "0.0.0.0:8080" }, 100, 200),
      pipelineNode("trn", "geoip", "GeoIP enrich", "geoip", "TRANSFORM", { database: "/etc/vector/GeoLite2-City.mmdb", source: ".ip", target: "geoip" }, 350, 200),
      pipelineNode("snk", "es", "Elasticsearch", "elasticsearch", "SINK", { endpoints: ["https://es.demo.internal:9200"], mode: "bulk", api_key: "SECRET[elastic_api_key]" }, 600, 200),
    ],
  }),
  pipelineDef({
    id: QA_IDS.pipelines[2],
    short: "met",
    name: "metrics-aggregator",
    description: "Vector metrics → aggregate by tags → Datadog.",
    environmentId: ENVIRONMENTS[0].id,
    tags: ["platform", "monitoring"],
    deployedDaysAgo: 4,
    baseEvents: 32_000,
    reduction: 0.65,
    errorRate: 0.0001,
    bytesPerEvent: 180,
    statusRows: [
      statusRow(VECTOR_NODES[3].id, 1, "RUNNING", 32_000_000, 11_200_000, 3_200, 17_596_800, 5_760_000_000, 1_843_200_000, 0.78),
      statusRow(VECTOR_NODES[4].id, 1, "RUNNING", 31_500_000, 11_025_000, 3_150, 17_321_850, 5_670_000_000, 1_814_400_000, 0.61),
    ],
    nodes: [
      pipelineNode("src", "metrics_in", "Vector metrics", "internal_metrics", "SOURCE", {}, 100, 200),
      pipelineNode("trn", "agg", "Aggregate", "aggregate", "TRANSFORM", { interval_ms: 10_000 }, 350, 200),
      pipelineNode("snk", "dd", "Datadog", "datadog_metrics", "SINK", { site: "datadoghq.com", default_namespace: "vectorflow_demo" }, 600, 200),
    ],
  }),
  pipelineDef({
    id: QA_IDS.pipelines[3],
    short: "sys",
    name: "syslog-to-loki",
    description: "Syslog ingestion → severity filter → Loki.",
    environmentId: ENVIRONMENTS[1].id,
    tags: ["platform", "ingest"],
    deployedDaysAgo: 8,
    baseEvents: 6_800,
    reduction: 0.35,
    errorRate: 0.005,
    bytesPerEvent: 240,
    statusRows: [statusRow(VECTOR_NODES[5].id, 2, "RUNNING", 6_800_000, 4_420_000, 34_000, 2_346_000, 1_632_000_000, 889_000_000, 0.31)],
    nodes: [
      pipelineNode("src", "syslog_in", "Syslog UDP", "syslog", "SOURCE", { address: "0.0.0.0:514", mode: "udp" }, 100, 200),
      pipelineNode("trn", "severity_filter", "Drop debug", "filter", "TRANSFORM", { condition: '.severity != "debug"' }, 350, 200),
      pipelineNode("snk", "loki", "Loki", "loki", "SINK", { endpoint: "http://loki:3100", labels: { pipeline: "syslog-to-loki" } }, 600, 200),
    ],
  }),
  pipelineDef({
    id: QA_IDS.pipelines[4],
    short: "app",
    name: "app-logs-to-clickhouse",
    description: "Application logs → schema validate → ClickHouse.",
    environmentId: ENVIRONMENTS[1].id,
    tags: ["data", "ingest"],
    deployedDaysAgo: 6,
    baseEvents: 9_100,
    reduction: 0.18,
    errorRate: 0.012,
    bytesPerEvent: 410,
    statusRows: [statusRow(VECTOR_NODES[6].id, 1, "RUNNING", 9_100_000, 7_462_000, 109_200, 1_528_800, 3_731_000_000, 2_540_000_000, 0.28)],
    nodes: [
      pipelineNode("src", "vector_in", "Upstream", "vector", "SOURCE", { address: "0.0.0.0:6000" }, 100, 200),
      pipelineNode("trn", "validate", "Schema validate", "remap", "TRANSFORM", { source: "if !is_object(.) { abort }" }, 350, 200),
      pipelineNode("snk", "ch", "ClickHouse", "clickhouse", "SINK", { endpoint: "http://clickhouse:8123", database: "app", table: "events", password: "SECRET[clickhouse_password]" }, 600, 200),
    ],
  }),
  pipelineDef({
    id: QA_IDS.pipelines[5],
    short: "aud",
    name: "audit-trail-to-splunk",
    description: "Audit events → redact PII → Splunk HEC.",
    environmentId: ENVIRONMENTS[1].id,
    tags: ["security", "compliance"],
    deployedDaysAgo: 5,
    baseEvents: 1_800,
    reduction: 0.02,
    errorRate: 0.0003,
    bytesPerEvent: 720,
    statusRows: [statusRow(VECTOR_NODES[7].id, 1, "RUNNING", 1_800_000, 1_764_000, 540, 35_460, 1_296_000_000, 1_101_000_000, 0.83)],
    nodes: [
      pipelineNode("src", "audit_kafka", "Audit Kafka topic", "kafka", "SOURCE", { bootstrap_servers: "kafka:9092", group_id: "vf-audit", topics: ["audit"] }, 100, 200),
      pipelineNode("trn", "redact", "Redact PII", "remap", "TRANSFORM", { source: "del(.email)\ndel(.ip)\ndel(.user_id)" }, 350, 200),
      pipelineNode("snk", "splunk", "Splunk HEC", "splunk_hec_logs", "SINK", { endpoint: "https://splunk.demo.internal:8088", index: "audit", token: "SECRET[splunk_hec_token]" }, 600, 200),
    ],
  }),
  pipelineDef({
    id: QA_IDS.pipelines[6],
    short: "dev",
    name: "dev-firehose",
    description: "Development log firehose → noop sink (sandbox).",
    environmentId: ENVIRONMENTS[2].id,
    tags: ["dev", "sandbox"],
    deployedDaysAgo: 3,
    baseEvents: 800,
    reduction: 0,
    errorRate: 0.04,
    bytesPerEvent: 290,
    statusRows: [statusRow(VECTOR_NODES[9].id, 1, "RUNNING", 800_000, 800_000, 32_000, 0, 232_000_000, 232_000_000, 0.22), statusRow(VECTOR_NODES[11].id, 1, "RUNNING", 780_000, 780_000, 31_200, 0, 226_000_000, 226_000_000, 0.19)],
    nodes: [
      pipelineNode("src", "demo_in", "Demo source", "demo_logs", "SOURCE", { interval: 1, format: "json" }, 100, 200),
      pipelineNode("trn", "remap", "Remap", "remap", "TRANSFORM", { source: '.env = "development"' }, 350, 200),
      pipelineNode("snk", "blackhole", "Blackhole", "blackhole", "SINK", { print_interval_secs: 60 }, 600, 200),
    ],
  }),
  pipelineDef({
    id: QA_IDS.pipelines[7],
    short: "trc",
    name: "trace-spans-to-tempo",
    description: "OTLP traces → tail sampling → Tempo.",
    environmentId: ENVIRONMENTS[2].id,
    tags: ["tracing", "dev"],
    deployedDaysAgo: 2,
    baseEvents: 2_400,
    reduction: 0.85,
    errorRate: 0.001,
    bytesPerEvent: 1_100,
    statusRows: [statusRow(VECTOR_NODES[10].id, 1, "RUNNING", 2_400_000, 360_000, 2_400, 2_037_600, 2_640_000_000, 792_000_000, 0.41)],
    nodes: [
      pipelineNode("src", "otlp_in", "OTLP traces", "opentelemetry", "SOURCE", { grpc: { address: "0.0.0.0:4317" } }, 100, 200),
      pipelineNode("trn", "sampler", "Tail sampling", "sample", "TRANSFORM", { rate: 10 }, 350, 200),
      pipelineNode("snk", "tempo", "Tempo", "loki", "SINK", { endpoint: "http://tempo:3200", token: "SECRET[tempo_token]" }, 600, 200),
    ],
  }),
] as const;

const SECRETS = [
  secretDef("s3_archive_key", ENVIRONMENTS[0].id, 13),
  secretDef("elastic_api_key", ENVIRONMENTS[0].id, 11),
  secretDef("clickhouse_password", ENVIRONMENTS[1].id, 8),
  secretDef("splunk_hec_token", ENVIRONMENTS[1].id, 7),
  secretDef("tempo_token", ENVIRONMENTS[2].id, 5),
];

const TEMPLATES = [
  templateFromPipeline(QA_IDS.templates[0], "k8s-archive-template", "Kubernetes logs → parse JSON → S3 archive.", "Logging", PIPELINES[0]),
  templateFromPipeline(QA_IDS.templates[1], "audit-splunk-template", "Audit events with PII redaction routed to Splunk.", "Data Protection", PIPELINES[5]),
  templateFromPipeline(QA_IDS.templates[2], "trace-tempo-template", "OTLP traces with sampling and Tempo delivery.", "Metrics", PIPELINES[7]),
];

const SHARED_COMPONENTS = [
  {
    id: "qa-shared-redact-pii",
    name: "redact-pii",
    description: "Reusable remap transform that strips direct identifiers from audit records.",
    componentType: "remap",
    kind: "TRANSFORM",
    config: { source: "del(.email)\\ndel(.ip)\\ndel(.user_id)" },
    version: 3,
    environmentId: ENVIRONMENTS[1].id,
    createdAt: daysAgo(9),
    updatedAt: daysAgo(1),
  },
  {
    id: "qa-shared-otlp-ingress",
    name: "otlp-ingress",
    description: "Standard OTLP gRPC listener used by tracing pipelines.",
    componentType: "opentelemetry",
    kind: "SOURCE",
    config: { grpc: { address: "0.0.0.0:4317" } },
    version: 2,
    environmentId: ENVIRONMENTS[1].id,
    createdAt: daysAgo(8),
    updatedAt: daysAgo(2),
  },
] as const;

const SERVICE_ACCOUNTS = [
  {
    id: QA_IDS.serviceAccounts[0],
    name: "ci-bot",
    description: "Deploys staging pipelines from CI",
    hashedKey: "qa-hash-ci-bot",
    keyPrefix: "vfqa_ci",
    environmentId: ENVIRONMENTS[1].id,
    permissions: ["pipelines.read", "pipelines.write", "pipelines.deploy", "alerts.read"],
    createdById: QA_IDS.user,
    lastUsedAt: hoursAgo(3),
    expiresAt: daysFromNow(30),
    enabled: true,
    rateLimit: 120,
  },
  {
    id: QA_IDS.serviceAccounts[1],
    name: "analytics-export",
    description: "Exports fleet and cost metrics",
    hashedKey: "qa-hash-analytics-export",
    keyPrefix: "vfqa_an",
    environmentId: ENVIRONMENTS[0].id,
    permissions: ["metrics.read", "audit.read", "audit.export", "secrets.read"],
    createdById: QA_IDS.user,
    lastUsedAt: hoursAgo(18),
    expiresAt: null,
    enabled: true,
    rateLimit: 60,
  },
] as const;

const NOTIFICATION_CHANNELS = [
  {
    id: QA_IDS.notificationChannels[0],
    environmentId: ENVIRONMENTS[0].id,
    name: "prod-slack",
    type: "slack",
    config: { webhookUrl: "https://hooks.slack.invalid/services/demo/prod" },
    enabled: true,
    createdAt: daysAgo(11),
    updatedAt: daysAgo(11),
  },
  {
    id: QA_IDS.notificationChannels[1],
    environmentId: ENVIRONMENTS[1].id,
    name: "staging-pagerduty",
    type: "pagerduty",
    config: { integrationKey: "pd-demo-key" },
    enabled: true,
    createdAt: daysAgo(8),
    updatedAt: daysAgo(8),
  },
] as const;

const ALERT_RULES = [
  alertRuleDef(QA_IDS.alertRules[0], "High CPU on production edge", ENVIRONMENTS[0].id, "cpu_usage", "gt", 75, 300, "critical", QA_IDS.notificationChannels[0]),
  alertRuleDef(QA_IDS.alertRules[1], "Pipeline error rate > 1%", ENVIRONMENTS[0].id, "error_rate", "gt", 1, 600, "warning", QA_IDS.notificationChannels[0], PIPELINES[0].id),
  alertRuleDef(QA_IDS.alertRules[2], "Node unreachable", ENVIRONMENTS[1].id, "node_unreachable", null, null, 120, "critical", QA_IDS.notificationChannels[1]),
  alertRuleDef(QA_IDS.alertRules[3], "Staging memory usage", ENVIRONMENTS[1].id, "memory_usage", "gt", 80, 300, "warning", QA_IDS.notificationChannels[1]),
  alertRuleDef(QA_IDS.alertRules[4], "Backup failed", ENVIRONMENTS[0].id, "backup_failed", null, null, null, "critical", QA_IDS.notificationChannels[0]),
  alertRuleDef(QA_IDS.alertRules[5], "New version available", ENVIRONMENTS[0].id, "new_version_available", null, null, null, "info", QA_IDS.notificationChannels[0]),
] as const;

const CORRELATION_GROUPS = [
  {
    id: QA_IDS.correlationGroups[0],
    environmentId: ENVIRONMENTS[0].id,
    status: "firing",
    eventCount: 2,
    openedAt: minutesAgo(40),
  },
  {
    id: QA_IDS.correlationGroups[1],
    environmentId: ENVIRONMENTS[1].id,
    status: "acknowledged",
    eventCount: 2,
    openedAt: hoursAgo(3),
  },
] as const;

const ALERT_EVENTS = [
  {
    id: "qa-alert-evt-cpu-firing",
    alertRuleId: QA_IDS.alertRules[0],
    nodeId: VECTOR_NODES[3].id,
    status: "firing",
    value: 87.4,
    message: "CPU 87.4% > 75% for 5m on vf-prod-aggregator-01.",
    firedAt: minutesAgo(18),
    correlationGroupId: QA_IDS.correlationGroups[0],
  },
  {
    id: "qa-alert-evt-unreach-firing",
    alertRuleId: QA_IDS.alertRules[2],
    nodeId: VECTOR_NODES[8].id,
    status: "firing",
    value: 1,
    message: "vf-staging-04 stopped responding to heartbeats.",
    firedAt: hoursAgo(3),
    correlationGroupId: QA_IDS.correlationGroups[1],
  },
  {
    id: "qa-alert-evt-err-1",
    alertRuleId: QA_IDS.alertRules[1],
    nodeId: VECTOR_NODES[0].id,
    status: "resolved",
    value: 1.4,
    message: "Error rate 1.4% on k8s-logs-to-s3.",
    firedAt: daysAgo(7, 4),
    resolvedAt: daysAgo(7, 3.7),
  },
  {
    id: "qa-alert-evt-err-2",
    alertRuleId: QA_IDS.alertRules[1],
    nodeId: VECTOR_NODES[1].id,
    status: "resolved",
    value: 1.7,
    message: "Error rate 1.7% on k8s-logs-to-s3.",
    firedAt: daysAgo(5, 11),
    resolvedAt: daysAgo(5, 10.5),
  },
  {
    id: "qa-alert-evt-mem-1",
    alertRuleId: QA_IDS.alertRules[3],
    nodeId: VECTOR_NODES[7].id,
    status: "acknowledged",
    value: 84.2,
    message: "Memory 84.2% on vf-staging-03.",
    firedAt: daysAgo(2, 10),
    acknowledgedAt: daysAgo(2, 9.8),
    acknowledgedBy: QA_IDS.user,
  },
  {
    id: "qa-alert-evt-backup",
    alertRuleId: QA_IDS.alertRules[4],
    nodeId: null,
    status: "resolved",
    value: 1,
    message: "Nightly backup failed: S3 timeout.",
    firedAt: hoursAgo(36),
    resolvedAt: hoursAgo(35),
  },
] as const;

const ANOMALY_EVENTS = [
  {
    id: "qa-anom-01",
    pipelineId: PIPELINES[0].id,
    environmentId: ENVIRONMENTS[0].id,
    teamId: QA_IDS.team,
    anomalyType: "throughput_drop",
    severity: "critical",
    metricName: "eventsIn",
    currentValue: 8_200,
    baselineMean: 18_000,
    baselineStddev: 1_800,
    deviationFactor: 5.4,
    message: "eventsIn dropped 54% on k8s-logs-to-s3",
    status: "open",
    detectedAt: minutesAgo(40),
    correlationGroupId: QA_IDS.correlationGroups[0],
  },
  {
    id: "qa-anom-02",
    pipelineId: PIPELINES[2].id,
    environmentId: ENVIRONMENTS[0].id,
    teamId: QA_IDS.team,
    anomalyType: "error_rate_spike",
    severity: "warning",
    metricName: "errorsTotal",
    currentValue: 240,
    baselineMean: 80,
    baselineStddev: 30,
    deviationFactor: 5.3,
    message: "errorsTotal 3x baseline on metrics-aggregator",
    status: "acknowledged",
    detectedAt: hoursAgo(2.2),
    acknowledgedAt: hoursAgo(2),
    acknowledgedBy: QA_IDS.user,
  },
  {
    id: "qa-anom-03",
    pipelineId: PIPELINES[4].id,
    environmentId: ENVIRONMENTS[1].id,
    teamId: QA_IDS.team,
    anomalyType: "latency_spike",
    severity: "info",
    metricName: "latencyMeanMs",
    currentValue: 19,
    baselineMean: 8,
    baselineStddev: 2,
    deviationFactor: 5.5,
    message: "latencyMeanMs above baseline on app-logs-to-clickhouse",
    status: "open",
    detectedAt: hoursAgo(6),
    correlationGroupId: QA_IDS.correlationGroups[1],
  },
  {
    id: "qa-anom-04",
    pipelineId: PIPELINES[3].id,
    environmentId: ENVIRONMENTS[1].id,
    teamId: QA_IDS.team,
    anomalyType: "throughput_spike",
    severity: "warning",
    metricName: "eventsIn",
    currentValue: 12_000,
    baselineMean: 6_800,
    baselineStddev: 900,
    deviationFactor: 5.8,
    message: "eventsIn 2x baseline on syslog-to-loki",
    status: "acknowledged",
    detectedAt: daysAgo(1),
    acknowledgedAt: hoursAgo(23),
    acknowledgedBy: QA_IDS.user,
  },
] as const;

const COST_RECOMMENDATIONS = [
  costRecDef("qa-cost-rec-k8s", ENVIRONMENTS[0].id, PIPELINES[0].id, "LOW_REDUCTION", "Switch S3 sink from gzip JSON to compressed Parquet", 25_920_000_000, daysAgo(1)),
  costRecDef("qa-cost-rec-met", ENVIRONMENTS[0].id, PIPELINES[2].id, "HIGH_ERROR_RATE", "Datadog API errors elevated on metrics-aggregator", 1_800_000_000, hoursAgo(12)),
  costRecDef("qa-cost-rec-app", ENVIRONMENTS[1].id, PIPELINES[4].id, "HIGH_ERROR_RATE", "app-logs-to-clickhouse error rate above 1%", 3_500_000_000, daysAgo(2)),
  costRecDef("qa-cost-rec-aud", ENVIRONMENTS[1].id, PIPELINES[5].id, "LOW_REDUCTION", "audit-trail-to-splunk drops only 2% of bytes", 8_000_000_000, daysAgo(3)),
  costRecDef("qa-cost-rec-trc", ENVIRONMENTS[2].id, PIPELINES[7].id, "STALE_PIPELINE", "trace-spans-to-tempo: tail sampling rate too aggressive", 500_000_000, hoursAgo(6)),
] as const;

const PROMOTIONS = [
  promotionDef(QA_IDS.promotions[0], PIPELINES[4].id, ENVIRONMENTS[1].id, ENVIRONMENTS[0].id, "PENDING", "app-logs-to-clickhouse", null),
  promotionDef(QA_IDS.promotions[1], PIPELINES[5].id, ENVIRONMENTS[1].id, ENVIRONMENTS[0].id, "APPROVED", "audit-trail-to-splunk", hoursAgo(10)),
  promotionDef(QA_IDS.promotions[2], PIPELINES[7].id, ENVIRONMENTS[2].id, ENVIRONMENTS[1].id, "DEPLOYING", "trace-spans-to-tempo", hoursAgo(4)),
  promotionDef(QA_IDS.promotions[3], PIPELINES[3].id, ENVIRONMENTS[1].id, ENVIRONMENTS[0].id, "DEPLOYED", "syslog-to-loki", daysAgo(2)),
  promotionDef(QA_IDS.promotions[4], PIPELINES[6].id, ENVIRONMENTS[2].id, ENVIRONMENTS[1].id, "REJECTED", "dev-firehose", daysAgo(3), "Schema drift in target environment"),
] as const;

const MIGRATION_PROJECTS = [
  {
    id: QA_IDS.migrationProjects[0],
    teamId: QA_IDS.team,
    name: "Fluentd EU edge migration",
    platform: "FLUENTD",
    originalConfig: "<source>\\n  @type tail\\n</source>",
    pluginInventory: { sources: ["tail"], filters: ["record_transformer"], outputs: ["s3"] },
    readinessScore: 82,
    readinessReport: { summary: "Mostly compatible with one custom parser to rewrite." },
    translatedBlocks: [{ block: "record_transformer", confidence: 0.92 }],
    validationResult: { ok: true },
    generatedPipelineId: PIPELINES[0].id,
    status: "READY",
    createdAt: daysAgo(6),
    updatedAt: daysAgo(1),
    createdById: QA_IDS.user,
  },
  {
    id: QA_IDS.migrationProjects[1],
    teamId: QA_IDS.team,
    name: "Vector syslog import",
    platform: "FLUENTD",
    originalConfig: "sources:\\n  syslog:\\n    type: syslog",
    pluginInventory: { sources: ["syslog"], outputs: ["loki"] },
    readinessScore: 96,
    readinessReport: { summary: "Import ready." },
    translatedBlocks: [{ block: "syslog", confidence: 0.99 }],
    validationResult: { ok: true },
    generatedPipelineId: PIPELINES[3].id,
    status: "COMPLETED",
    createdAt: daysAgo(4),
    updatedAt: daysAgo(2),
    createdById: QA_IDS.user,
  },
] as const;

const DEPLOY_REQUESTS = [
  {
    id: "qa-deploy-prod-k8s",
    pipelineId: PIPELINES[0].id,
    environmentId: ENVIRONMENTS[0].id,
    requestedById: QA_IDS.user,
    configYaml: "# qa deploy config for k8s-logs-to-s3",
    changelog: "Rotate archive bucket credentials",
    status: "DEPLOYED",
    reviewedById: QA_IDS.user,
    reviewNote: "Approved for production",
    createdAt: daysAgo(1),
    reviewedAt: hoursAgo(20),
    deployedById: QA_IDS.user,
    deployedAt: hoursAgo(19),
  },
  {
    id: "qa-deploy-staging-app",
    pipelineId: PIPELINES[4].id,
    environmentId: ENVIRONMENTS[1].id,
    requestedById: QA_IDS.user,
    configYaml: "# qa deploy config for app-logs-to-clickhouse",
    changelog: "Add schema validation",
    status: "PENDING",
    createdAt: hoursAgo(6),
  },
] as const;

const AUDIT_LOGS = [
  auditLog("qa-audit-01", "user.login", "User", QA_IDS.user, null, { method: "credentials" }, daysAgo(14)),
  auditLog("qa-audit-02", "environment.created", "Environment", ENVIRONMENTS[0].id, ENVIRONMENTS[0].id, { name: ENVIRONMENTS[0].name }, daysAgo(14, -0.1)),
  auditLog("qa-audit-03", "environment.created", "Environment", ENVIRONMENTS[1].id, ENVIRONMENTS[1].id, { name: ENVIRONMENTS[1].name }, daysAgo(14, -0.08)),
  auditLog("qa-audit-04", "environment.created", "Environment", ENVIRONMENTS[2].id, ENVIRONMENTS[2].id, { name: ENVIRONMENTS[2].name }, daysAgo(14, -0.05)),
  auditLog("qa-audit-05", "pipeline.created", "Pipeline", PIPELINES[0].id, ENVIRONMENTS[0].id, { name: PIPELINES[0].name }, daysAgo(11)),
  auditLog("qa-audit-06", "pipeline.deployed", "Pipeline", PIPELINES[0].id, ENVIRONMENTS[0].id, { version: 4, nodeCount: 2 }, daysAgo(11, -2)),
  auditLog("qa-audit-07", "alertRule.created", "AlertRule", QA_IDS.alertRules[0], ENVIRONMENTS[0].id, { metric: "cpu_usage", threshold: 75 }, daysAgo(11, -3)),
  auditLog("qa-audit-08", "pipeline.created", "Pipeline", PIPELINES[1].id, ENVIRONMENTS[0].id, { name: PIPELINES[1].name }, daysAgo(9)),
  auditLog("qa-audit-09", "pipeline.updated", "Pipeline", PIPELINES[2].id, ENVIRONMENTS[0].id, { change: "added aggregate transform", version: 1 }, daysAgo(4)),
  auditLog("qa-audit-10", "promotion.initiated", "PromotionRequest", QA_IDS.promotions[0], ENVIRONMENTS[1].id, { targetEnvironment: "production" }, hoursAgo(12)),
  auditLog("qa-audit-11", "anomalyEvent.acknowledged", "AnomalyEvent", ANOMALY_EVENTS[3].id, ENVIRONMENTS[1].id, { anomalyType: "throughput_spike" }, hoursAgo(23)),
  auditLog("qa-audit-12", "user.login", "User", QA_IDS.user, null, { method: "credentials" }, hoursAgo(1)),
] as const;

async function seedQa(prisma: PrismaClient) {
  const enrollmentToken = await generateEnrollmentToken();
  const nodeToken = await generateNodeToken();

  await prisma.user.create({
    data: {
      id: QA_IDS.user,
      email: QA_DEV_USER.email,
      name: QA_DEV_USER.name,
      passwordHash: null,
      authMethod: "LOCAL",
      totpEnabled: true,
      mustChangePassword: false,
      createdAt: daysAgo(14),
    },
  });

  await prisma.team.create({
    data: {
      id: QA_IDS.team,
      name: "QA Dev Workspace",
      createdAt: daysAgo(14),
    },
  });

  await prisma.teamMember.create({
    data: {
      userId: QA_IDS.user,
      teamId: QA_IDS.team,
      role: "ADMIN",
      source: "qa_seed",
    },
  });

  await prisma.environment.createMany({
    data: ENVIRONMENTS.map((env, index) => ({
      id: env.id,
      name: env.name,
      isSystem: false,
      teamId: QA_IDS.team,
      secretBackend: "BUILTIN",
      gitOpsMode: "off",
      enrollmentTokenHash: index === 0 ? enrollmentToken.hash : null,
      enrollmentTokenHint: index === 0 ? enrollmentToken.hint : null,
      costPerGbCents: env.costPerGbCents,
      costBudgetCents: env.costBudgetCents,
      createdAt: env.createdAt,
    })),
  });

  await prisma.team.update({
    where: { id: QA_IDS.team },
    data: { defaultEnvironmentId: QA_IDS.environment },
  });

  await prisma.vectorNode.createMany({
    data: VECTOR_NODES.map((node, index) => ({
      id: node.id,
      name: node.name,
      host: node.host,
      apiPort: 8686,
      environmentId: node.environmentId,
      status: node.status,
      lastSeen: node.status === "UNREACHABLE" ? hoursAgo(3) : secondsAgo(index + 1),
      lastHeartbeat: node.status === "UNREACHABLE" ? hoursAgo(3) : secondsAgo(index + 1),
      enrolledAt: node.enrolledAt,
      nodeTokenHash: index === 0 ? nodeToken.hash : null,
      agentVersion: node.agentVersion,
      vectorVersion: node.vectorVersion,
      os: node.os,
      deploymentMode: node.deploymentMode,
      maintenanceMode: false,
      labels: node.labels,
      createdAt: node.enrolledAt,
    })),
  });

  await prisma.nodeStatusEvent.createMany({
    data: VECTOR_NODES.flatMap((node) => {
      const enrolled = {
        id: `${node.id}-enrolled`,
        nodeId: node.id,
        fromStatus: null,
        toStatus: "HEALTHY",
        reason: "enrolled",
        timestamp: node.enrolledAt,
      };
      if (node.status === "DEGRADED") {
        return [enrolled, { id: `${node.id}-degraded`, nodeId: node.id, fromStatus: "HEALTHY", toStatus: "DEGRADED", reason: "elevated CPU", timestamp: hoursAgo(6) }];
      }
      if (node.status === "UNREACHABLE") {
        return [enrolled, { id: `${node.id}-unreachable`, nodeId: node.id, fromStatus: "HEALTHY", toStatus: "UNREACHABLE", reason: "heartbeat timeout", timestamp: hoursAgo(3) }];
      }
      return [enrolled];
    }),
  });

  await prisma.pipeline.createMany({
    data: PIPELINES.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description,
      environmentId: pipeline.environmentId,
      isDraft: false,
      isSystem: false,
      deployedAt: pipeline.deployedAt,
      createdById: QA_IDS.user,
      updatedById: QA_IDS.user,
      tags: pipeline.tags,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
    })),
  });

  await prisma.pipelineNode.createMany({
    data: PIPELINES.flatMap((pipeline) =>
      pipeline.nodes.map((node) => ({
        id: node.id,
        pipelineId: pipeline.id,
        componentKey: node.componentKey,
        displayName: node.displayName,
        componentType: node.componentType,
        kind: node.kind,
        config: node.config,
        positionX: node.positionX,
        positionY: node.positionY,
        disabled: false,
      })),
    ) as Prisma.PipelineNodeCreateManyInput[],
  });

  await prisma.pipelineEdge.createMany({
    data: PIPELINES.flatMap((pipeline) =>
      pipeline.edges.map((edge) => ({
        id: edge.id,
        pipelineId: pipeline.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      })),
    ),
  });

  await prisma.pipelineVersion.createMany({
    data: PIPELINES.map((pipeline) => ({
      id: `${pipeline.id}-v1`,
      pipelineId: pipeline.id,
      version: pipeline.version,
      configYaml: `# QA seed pipeline config for ${pipeline.name}`,
      nodesSnapshot: pipeline.nodes,
      edgesSnapshot: pipeline.edges,
      createdById: QA_IDS.user,
      changelog: `Seeded ${pipeline.name}`,
      createdAt: pipeline.deployedAt,
    })) as Prisma.PipelineVersionCreateManyInput[],
  });

  await prisma.nodePipelineStatus.createMany({
    data: PIPELINES.flatMap((pipeline) =>
      pipeline.statusRows.map((status) => ({
        id: `${status.nodeId}-${pipeline.id}`,
        nodeId: status.nodeId,
        pipelineId: pipeline.id,
        version: status.version,
        status: status.status,
        eventsIn: status.eventsIn,
        eventsOut: status.eventsOut,
        errorsTotal: status.errorsTotal,
        eventsDiscarded: status.eventsDiscarded,
        bytesIn: status.bytesIn,
        bytesOut: status.bytesOut,
        utilization: status.utilization,
        lastUpdated: status.lastUpdated,
      })),
    ),
  });

  await prisma.secret.createMany({
    data: SECRETS.map((secret) => ({
      id: `${secret.environmentId}-${secret.name}`,
      name: secret.name,
      encryptedValue: `encrypted-${secret.name}`,
      environmentId: secret.environmentId,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
    })),
  });
  await prisma.sharedComponent.createMany({ data: SHARED_COMPONENTS.map((component) => ({ ...component })) as Prisma.SharedComponentCreateManyInput[] });

  await prisma.template.createMany({
    data: TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      teamId: QA_IDS.team,
      nodes: template.nodes,
      edges: template.edges,
      createdAt: template.createdAt,
    })) as Prisma.TemplateCreateManyInput[],
  });

  await prisma.serviceAccount.createMany({
    data: SERVICE_ACCOUNTS.map((account) => ({
      ...account,
      createdAt: daysAgo(5),
    })),
  });

  await prisma.notificationChannel.createMany({ data: NOTIFICATION_CHANNELS.map((channel) => ({ ...channel })) as Prisma.NotificationChannelCreateManyInput[] });

  await prisma.alertRule.createMany({
    data: ALERT_RULES.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: true,
      environmentId: rule.environmentId,
      pipelineId: rule.pipelineId,
      teamId: QA_IDS.team,
      metric: rule.metric,
      condition: rule.condition,
      threshold: rule.threshold,
      durationSeconds: rule.durationSeconds,
      severity: rule.severity,
      ownerHint: "platform-ops",
      suggestedAction: "Inspect the pipeline, node, and most recent deployment before acknowledging this alert.",
      cooldownMinutes: rule.cooldownMinutes,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    })) as Prisma.AlertRuleCreateManyInput[],
  });

  await prisma.alertRuleChannel.createMany({
    data: ALERT_RULES.map((rule, index) => ({
      id: `qa-arc-${index + 1}`,
      alertRuleId: rule.id,
      channelId: rule.channelId,
    })),
  });

  await prisma.alertCorrelationGroup.createMany({ data: CORRELATION_GROUPS.map((group) => ({ ...group })) as Prisma.AlertCorrelationGroupCreateManyInput[] });
  await prisma.alertEvent.createMany({ data: ALERT_EVENTS.map((event) => ({ ...event })) as Prisma.AlertEventCreateManyInput[] });
  await prisma.anomalyEvent.createMany({ data: ANOMALY_EVENTS.map((event) => ({ ...event, createdAt: event.detectedAt })) as Prisma.AnomalyEventCreateManyInput[] });
  await prisma.costRecommendation.createMany({ data: COST_RECOMMENDATIONS.map((recommendation) => ({ ...recommendation })) as Prisma.CostRecommendationCreateManyInput[] });
  await prisma.release.createMany({ data: PROMOTIONS.map((promotion) => ({ ...promotion })) as Prisma.ReleaseCreateManyInput[] });
  await prisma.release.createMany({ data: DEPLOY_REQUESTS.map((request) => ({ ...request, strategy: "DIRECT" as const })) as Prisma.ReleaseCreateManyInput[] });
  await prisma.auditLog.createMany({ data: AUDIT_LOGS.map((entry) => ({ ...entry })) as Prisma.AuditLogCreateManyInput[] });
  await prisma.migrationProject.createMany({ data: MIGRATION_PROJECTS.map((project) => ({ ...project })) as Prisma.MigrationProjectCreateManyInput[] });

  await createManyInChunks(prisma.pipelineMetric, buildPipelineMetrics());
  await createManyInChunks(prisma.nodeMetric, buildNodeMetrics());

  return {
    userEmail: QA_DEV_USER.email,
    teamId: QA_IDS.team,
    environmentId: QA_IDS.environment,
    pipelineId: QA_IDS.pipeline,
    pipelineUrl: `/pipelines/${QA_IDS.pipeline}`,
    enrollmentTokenHint: enrollmentToken.hint,
    nodeEnrollmentStubbed: true,
  };
}

async function createManyInChunks<T extends object>(
  model: { createMany: (args: { data: T[] }) => Promise<unknown> },
  rows: T[],
  size = 1000,
) {
  for (let index = 0; index < rows.length; index += size) {
    await model.createMany({ data: rows.slice(index, index + size) });
  }
}

function buildPipelineMetrics() {
  const rows: Array<{
    id: string;
    pipelineId: string;
    nodeId: null;
    componentId: null;
    timestamp: Date;
    eventsIn: bigint;
    eventsOut: bigint;
    eventsDiscarded: bigint;
    errorsTotal: bigint;
    bytesIn: bigint;
    bytesOut: bigint;
    utilization: number;
    latencyMeanMs: number;
  }> = [];

  const now = Date.now();
  for (const pipeline of PIPELINES) {
    for (let slot = 0; slot <= 14 * 24 * 2; slot += 1) {
      const timestamp = new Date(now - (14 * 24 * 2 - slot) * 30 * 60 * 1000);
      const hour = timestamp.getHours() + timestamp.getMinutes() / 60;
      const weekdayFactor = [0, 6].includes(timestamp.getDay()) ? 0.55 : 1;
      const daily = 1 + 0.45 * Math.sin(((hour - 6) / 24) * Math.PI * 2);
      const noise = 0.88 + ((slot + pipeline.short.length) % 7) * 0.03;
      const eventsIn = Math.max(1, Math.round(pipeline.baseEvents * daily * weekdayFactor * noise));
      const errorsTotal = Math.max(0, Math.round(eventsIn * pipeline.errorRate));
      const eventsOut = Math.max(0, Math.round(eventsIn * (1 - pipeline.reduction)));
      const eventsDiscarded = Math.max(0, eventsIn - eventsOut - errorsTotal);
      const bytesIn = BigInt(Math.round(eventsIn * pipeline.bytesPerEvent));
      const bytesOut = BigInt(Math.round(eventsOut * pipeline.bytesPerEvent * 0.85));

      rows.push({
        id: `pm-${pipeline.short}-${slot}`,
        pipelineId: pipeline.id,
        nodeId: null,
        componentId: null,
        timestamp,
        eventsIn: BigInt(eventsIn),
        eventsOut: BigInt(eventsOut),
        eventsDiscarded: BigInt(eventsDiscarded),
        errorsTotal: BigInt(errorsTotal),
        bytesIn,
        bytesOut,
        utilization: Number(Math.min(0.99, Math.max(0.05, 0.2 + daily * 0.18 * noise)).toFixed(2)),
        latencyMeanMs: Number((6 + daily * weekdayFactor * (2 + ((slot + 3) % 9))).toFixed(2)),
      });
    }
  }

  return rows;
}

function buildNodeMetrics() {
  const rows: Array<{
    id: string;
    nodeId: string;
    timestamp: Date;
    memoryTotalBytes: bigint;
    memoryUsedBytes: bigint;
    memoryFreeBytes: bigint;
    cpuSecondsTotal: number;
    cpuSecondsIdle: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    fsTotalBytes: bigint;
    fsUsedBytes: bigint;
    fsFreeBytes: bigint;
    diskReadBytes: bigint;
    diskWrittenBytes: bigint;
    netRxBytes: bigint;
    netTxBytes: bigint;
  }> = [];

  const now = Date.now();
  for (const node of VECTOR_NODES.filter((entry) => entry.status !== "UNREACHABLE")) {
    for (let slot = 0; slot <= 14 * 24; slot += 1) {
      const timestamp = new Date(now - (14 * 24 - slot) * 60 * 60 * 1000);
      if (timestamp < node.enrolledAt) continue;
      const hour = timestamp.getHours();
      const weekdayFactor = [0, 6].includes(timestamp.getDay()) ? 0.55 : 1;
      const daily = 1 + 0.45 * Math.sin(((hour - 6) / 24) * Math.PI * 2);
      const noise = 0.82 + ((slot + node.name.length) % 5) * 0.05;
      const load = Math.min(0.99, node.baseLoad * daily * weekdayFactor * noise);
      const memoryUsed = BigInt(Math.round(16 * GB * (0.35 + load * 0.4)));
      const fsUsed = BigInt(Math.round(500 * GB * (0.4 + ((slot + 2) % 10) * 0.01)));
      const elapsedSeconds = Math.max(1, Math.round((timestamp.getTime() - node.enrolledAt.getTime()) / 1000));

      rows.push({
        id: `nm-${node.id}-${slot}`,
        nodeId: node.id,
        timestamp,
        memoryTotalBytes: BigInt(16 * GB),
        memoryUsedBytes: memoryUsed,
        memoryFreeBytes: BigInt(16 * GB) - memoryUsed,
        cpuSecondsTotal: elapsedSeconds * 4,
        cpuSecondsIdle: elapsedSeconds * 4 * (1 - load),
        loadAvg1: Number((4 * load).toFixed(2)),
        loadAvg5: Number((4 * load * 0.95).toFixed(2)),
        loadAvg15: Number((4 * load * 0.9).toFixed(2)),
        fsTotalBytes: BigInt(500 * GB),
        fsUsedBytes: fsUsed,
        fsFreeBytes: BigInt(500 * GB) - fsUsed,
        diskReadBytes: BigInt(Math.round((50_000 + load * 4_950_000) * (slot + 1))),
        diskWrittenBytes: BigInt(Math.round((100_000 + load * 7_900_000) * (slot + 1))),
        netRxBytes: BigInt(Math.round((500_000 + load * 49_500_000) * (slot + 1))),
        netTxBytes: BigInt(Math.round((200_000 + load * 29_800_000) * (slot + 1))),
      });
    }
  }

  return rows;
}

function nodeDef(
  id: string,
  name: string,
  host: string,
  environmentId: string,
  status: "HEALTHY" | "DEGRADED" | "UNREACHABLE",
  deploymentMode: "DOCKER" | "STANDALONE",
  os: string,
  agentVersion: string,
  vectorVersion: string,
  labels: Record<string, string>,
  enrolledDaysAgo: number,
  baseLoad: number,
) {
  return {
    id,
    name,
    host,
    environmentId,
    status,
    deploymentMode,
    os,
    agentVersion,
    vectorVersion,
    labels,
    enrolledAt: daysAgo(enrolledDaysAgo),
    baseLoad,
  };
}

function pipelineDef(input: {
  id: string;
  short: string;
  name: string;
  description: string;
  environmentId: string;
  tags: string[];
  deployedDaysAgo: number;
  baseEvents: number;
  reduction: number;
  errorRate: number;
  bytesPerEvent: number;
  statusRows: Array<ReturnType<typeof statusRow>>;
  nodes: Array<ReturnType<typeof pipelineNode>>;
}) {
  const nodes = input.nodes.map((node) => ({ ...node, id: `${input.id}-${node.suffix}` }));
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `${input.id}-edge-${index + 1}`,
    sourceNodeId: node.id,
    targetNodeId: nodes[index + 1]!.id,
  }));
  return {
    ...input,
    nodes,
    edges,
    version: 1,
    deployedAt: daysAgo(input.deployedDaysAgo),
    createdAt: daysAgo(input.deployedDaysAgo),
    updatedAt: daysAgo(Math.max(1, input.deployedDaysAgo - 1)),
  };
}

function pipelineNode(
  suffix: string,
  componentKey: string,
  displayName: string,
  componentType: string,
  kind: "SOURCE" | "TRANSFORM" | "SINK",
  config: Record<string, unknown>,
  positionX: number,
  positionY: number,
) {
  return { suffix, componentKey, displayName, componentType, kind, config, positionX, positionY, disabled: false };
}

function statusRow(
  nodeId: string,
  version: number,
  status: "RUNNING" | "PENDING" | "CRASHED" | "STOPPED",
  eventsIn: number,
  eventsOut: number,
  errorsTotal: number,
  eventsDiscarded: number,
  bytesIn: number,
  bytesOut: number,
  utilization: number,
) {
  return {
    nodeId,
    version,
    status,
    eventsIn: BigInt(eventsIn),
    eventsOut: BigInt(eventsOut),
    errorsTotal: BigInt(errorsTotal),
    eventsDiscarded: BigInt(eventsDiscarded),
    bytesIn: BigInt(bytesIn),
    bytesOut: BigInt(bytesOut),
    utilization,
    lastUpdated: minutesAgo(3),
  };
}

function templateFromPipeline(id: string, name: string, description: string, category: string, pipeline: (typeof PIPELINES)[number]) {
  return {
    id,
    name,
    description,
    category,
    nodes: pipeline.nodes.map((node) => ({
      id: node.id,
      componentType: node.componentType,
      componentKey: node.componentKey,
      kind: node.kind,
      config: node.config,
      positionX: node.positionX,
      positionY: node.positionY,
      metadata: { complianceTags: pipeline.tags },
    })),
    edges: pipeline.edges,
    createdAt: pipeline.createdAt,
  };
}

function secretDef(name: string, environmentId: string, updatedDaysAgo: number) {
  return {
    name,
    environmentId,
    createdAt: daysAgo(updatedDaysAgo + 2),
    updatedAt: daysAgo(updatedDaysAgo),
  };
}

function alertRuleDef(
  id: string,
  name: string,
  environmentId: string,
  metric: AlertMetric,
  condition: AlertCondition | null,
  threshold: number | null,
  durationSeconds: number | null,
  severity: string,
  channelId: string,
  pipelineId?: string,
) {
  return {
    id,
    name,
    environmentId,
    pipelineId: pipelineId ?? null,
    metric,
    condition,
    threshold,
    durationSeconds,
    severity,
    cooldownMinutes: 30,
    channelId,
    createdAt: daysAgo(11),
    updatedAt: daysAgo(11),
  };
}

function costRecDef(
  id: string,
  environmentId: string,
  pipelineId: string,
  type: "LOW_REDUCTION" | "HIGH_ERROR_RATE" | "STALE_PIPELINE",
  title: string,
  estimatedSavingsBytes: number,
  createdAt: Date,
) {
  return {
    id,
    teamId: QA_IDS.team,
    environmentId,
    pipelineId,
    type,
    status: "PENDING",
    title,
    description: title,
    analysisData: { sampleDays: 14 },
    estimatedSavingsBytes: BigInt(estimatedSavingsBytes),
    expiresAt: daysFromNow(7),
    createdAt,
    updatedAt: createdAt,
  };
}

function promotionDef(
  id: string,
  sourcePipelineId: string,
  sourceEnvironmentId: string,
  targetEnvironmentId: string,
  status: string,
  targetPipelineName: string,
  reviewedAt: Date | null,
  reviewNote?: string,
) {
  const source = PIPELINES.find((pipeline) => pipeline.id === sourcePipelineId)!;
  return {
    id,
    strategy: "PROMOTION" as const,
    pipelineId: sourcePipelineId,
    targetPipelineId: null,
    environmentId: sourceEnvironmentId,
    targetEnvironmentId,
    status,
    requestedById: QA_IDS.user,
    reviewedById: reviewedAt && status !== "REJECTED" ? QA_IDS.user : null,
    nodesSnapshot: source.nodes,
    edgesSnapshot: source.edges,
    globalConfigSnapshot: Prisma.JsonNull,
    targetPipelineName,
    reviewNote: reviewNote ?? null,
    prUrl: null,
    prNumber: null,
    changelog: "",
    createdAt: reviewedAt ?? hoursAgo(14),
    reviewedAt,
    deployedAt: status === "DEPLOYED" ? hoursAgo(6) : null,
  };
}

function auditLog(id: string, action: string, entityType: string, entityId: string, environmentId: string | null, metadata: Record<string, unknown>, createdAt: Date) {
  return {
    id,
    userId: QA_IDS.user,
    action,
    entityType,
    entityId,
    userEmail: QA_DEV_USER.email,
    userName: QA_DEV_USER.name,
    teamId: QA_IDS.team,
    environmentId,
    metadata,
    createdAt,
  };
}

function daysAgo(days: number, hoursOffset = 0) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 + hoursOffset * 60 * 60 * 1000);
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function secondsAgo(seconds: number) {
  return new Date(Date.now() - seconds * 1000);
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  const prisma = createPrismaClient();

  try {
    await resetQaSeed(prisma);
    const result = await seedQa(prisma);

    const { userEmail, teamId, environmentId, pipelineId, pipelineUrl, enrollmentTokenHint, nodeEnrollmentStubbed } = result;
    console.log(JSON.stringify({ userEmail, teamId, environmentId, pipelineId, pipelineUrl, enrollmentTokenHint, nodeEnrollmentStubbed }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
