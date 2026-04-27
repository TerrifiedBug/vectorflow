/**
 * Demo seed: populates the database with 14 days of realistic-looking data
 * so the dashboard, analytics, and fleet pages render full graphs in the
 * public demo. Idempotent: wipes existing demo records (by demo email) and
 * recreates everything from scratch.
 *
 * Run with: pnpm seed:demo
 *
 * Refuses to run unless NEXT_PUBLIC_VF_DEMO_MODE=true, so it cannot wipe
 * a real production database by accident.
 */
import bcrypt from "bcryptjs";
import { PrismaClient, type ComponentKind, type NodeStatus } from "../src/generated/prisma";

const prisma = new PrismaClient();

const DEMO_USER_EMAIL = "demo@demo.local";
const DEMO_USER_PASSWORD = "demo";
const DEMO_TEAM_NAME = "Demo Team";
const DAYS = 14;
const NOW = new Date();
const START = new Date(NOW.getTime() - DAYS * 24 * 60 * 60 * 1000);

const PIPELINE_METRIC_INTERVAL_MIN = 5;
const NODE_METRIC_INTERVAL_MIN = 15;

const PIPELINE_METRIC_INTERVAL_MS = PIPELINE_METRIC_INTERVAL_MIN * 60 * 1000;
const NODE_METRIC_INTERVAL_MS = NODE_METRIC_INTERVAL_MIN * 60 * 1000;

// ─── Pipeline templates ─────────────────────────────────────────────────────

const PIPELINE_TEMPLATES: Array<{
  name: string;
  description: string;
  envName: "Production" | "Staging" | "Development";
  baseEventsPerInterval: number;
  reductionRatio: number; // 0..1 — fraction of bytes that DON'T flow out (filtered)
  errorRate: number; // 0..1 — fraction of events that error
  bytesPerEvent: number; // average payload size in bytes
  nodes: Array<{ kind: ComponentKind; componentType: string; componentKey: string; displayName: string }>;
}> = [
  {
    name: "k8s-logs-to-s3",
    description: "Kubernetes pod logs → JSON parse → S3 archive",
    envName: "Production",
    baseEventsPerInterval: 18000,
    reductionRatio: 0.12,
    errorRate: 0.002,
    bytesPerEvent: 320,
    nodes: [
      { kind: "SOURCE", componentType: "kubernetes_logs", componentKey: "k8s_logs", displayName: "Pod logs" },
      { kind: "TRANSFORM", componentType: "remap", componentKey: "parse_json", displayName: "Parse JSON" },
      { kind: "SINK", componentType: "aws_s3", componentKey: "s3_archive", displayName: "S3 archive" },
    ],
  },
  {
    name: "auth-events-to-elastic",
    description: "Auth audit logs → enrich with geoip → Elasticsearch",
    envName: "Production",
    baseEventsPerInterval: 4200,
    reductionRatio: 0.05,
    errorRate: 0.0005,
    bytesPerEvent: 540,
    nodes: [
      { kind: "SOURCE", componentType: "http_server", componentKey: "auth_http", displayName: "Auth webhook" },
      { kind: "TRANSFORM", componentType: "geoip", componentKey: "geoip", displayName: "GeoIP enrich" },
      { kind: "SINK", componentType: "elasticsearch", componentKey: "es", displayName: "Elasticsearch" },
    ],
  },
  {
    name: "metrics-aggregator",
    description: "Vector metrics → aggregate by tags → Datadog",
    envName: "Production",
    baseEventsPerInterval: 32000,
    reductionRatio: 0.65, // heavy aggregation
    errorRate: 0.0001,
    bytesPerEvent: 180,
    nodes: [
      { kind: "SOURCE", componentType: "internal_metrics", componentKey: "metrics_in", displayName: "Vector metrics" },
      { kind: "TRANSFORM", componentType: "aggregate", componentKey: "agg", displayName: "Aggregate" },
      { kind: "SINK", componentType: "datadog_metrics", componentKey: "dd", displayName: "Datadog" },
    ],
  },
  {
    name: "syslog-to-loki",
    description: "Syslog ingestion → severity filter → Loki",
    envName: "Staging",
    baseEventsPerInterval: 6800,
    reductionRatio: 0.35,
    errorRate: 0.005,
    bytesPerEvent: 240,
    nodes: [
      { kind: "SOURCE", componentType: "syslog", componentKey: "syslog_in", displayName: "Syslog UDP" },
      { kind: "TRANSFORM", componentType: "filter", componentKey: "severity_filter", displayName: "Drop debug" },
      { kind: "SINK", componentType: "loki", componentKey: "loki", displayName: "Loki" },
    ],
  },
  {
    name: "app-logs-to-clickhouse",
    description: "Application logs → schema validate → ClickHouse",
    envName: "Staging",
    baseEventsPerInterval: 9100,
    reductionRatio: 0.18,
    errorRate: 0.012, // higher errors — surfaces in alerts
    bytesPerEvent: 410,
    nodes: [
      { kind: "SOURCE", componentType: "vector", componentKey: "vector_in", displayName: "Upstream" },
      { kind: "TRANSFORM", componentType: "remap", componentKey: "validate", displayName: "Schema validate" },
      { kind: "SINK", componentType: "clickhouse", componentKey: "ch", displayName: "ClickHouse" },
    ],
  },
  {
    name: "audit-trail-to-splunk",
    description: "Audit events → redact PII → Splunk HEC",
    envName: "Staging",
    baseEventsPerInterval: 1800,
    reductionRatio: 0.02,
    errorRate: 0.0003,
    bytesPerEvent: 720,
    nodes: [
      { kind: "SOURCE", componentType: "kafka", componentKey: "audit_kafka", displayName: "Audit Kafka topic" },
      { kind: "TRANSFORM", componentType: "remap", componentKey: "redact", displayName: "Redact PII" },
      { kind: "SINK", componentType: "splunk_hec_logs", componentKey: "splunk", displayName: "Splunk HEC" },
    ],
  },
  {
    name: "dev-firehose",
    description: "Development log firehose → noop sink (sandbox)",
    envName: "Development",
    baseEventsPerInterval: 800,
    reductionRatio: 0.0,
    errorRate: 0.04, // sandbox is messy
    bytesPerEvent: 290,
    nodes: [
      { kind: "SOURCE", componentType: "demo_logs", componentKey: "demo_in", displayName: "Demo source" },
      { kind: "TRANSFORM", componentType: "remap", componentKey: "remap", displayName: "Remap" },
      { kind: "SINK", componentType: "blackhole", componentKey: "blackhole", displayName: "Blackhole" },
    ],
  },
  {
    name: "trace-spans-to-tempo",
    description: "OTLP traces → tail sampling → Tempo",
    envName: "Development",
    baseEventsPerInterval: 2400,
    reductionRatio: 0.85, // tail sampling drops most
    errorRate: 0.001,
    bytesPerEvent: 1100,
    nodes: [
      { kind: "SOURCE", componentType: "opentelemetry", componentKey: "otlp_in", displayName: "OTLP traces" },
      { kind: "TRANSFORM", componentType: "sample", componentKey: "sampler", displayName: "Tail sampling" },
      { kind: "SINK", componentType: "loki", componentKey: "tempo", displayName: "Tempo" },
    ],
  },
];

const NODE_TEMPLATES: Array<{ name: string; envName: string; status: NodeStatus; agentVersion: string; vectorVersion: string; os: string; baseLoad: number }> = [
  { name: "vf-prod-edge-01", envName: "Production", status: "HEALTHY", agentVersion: "0.1.4", vectorVersion: "0.40.0", os: "linux", baseLoad: 0.45 },
  { name: "vf-prod-edge-02", envName: "Production", status: "HEALTHY", agentVersion: "0.1.4", vectorVersion: "0.40.0", os: "linux", baseLoad: 0.52 },
  { name: "vf-prod-edge-03", envName: "Production", status: "HEALTHY", agentVersion: "0.1.4", vectorVersion: "0.40.0", os: "linux", baseLoad: 0.38 },
  { name: "vf-prod-aggregator-01", envName: "Production", status: "DEGRADED", agentVersion: "0.1.3", vectorVersion: "0.39.0", os: "linux", baseLoad: 0.78 },
  { name: "vf-prod-aggregator-02", envName: "Production", status: "HEALTHY", agentVersion: "0.1.4", vectorVersion: "0.40.0", os: "linux", baseLoad: 0.61 },
  { name: "vf-staging-01", envName: "Staging", status: "HEALTHY", agentVersion: "0.1.4", vectorVersion: "0.40.0", os: "linux", baseLoad: 0.31 },
  { name: "vf-staging-02", envName: "Staging", status: "HEALTHY", agentVersion: "0.1.4", vectorVersion: "0.40.0", os: "linux", baseLoad: 0.28 },
  { name: "vf-staging-03", envName: "Staging", status: "DEGRADED", agentVersion: "0.1.3", vectorVersion: "0.39.0", os: "linux", baseLoad: 0.83 },
  { name: "vf-staging-04", envName: "Staging", status: "UNREACHABLE", agentVersion: "0.1.3", vectorVersion: "0.39.0", os: "linux", baseLoad: 0 },
  { name: "vf-dev-laptop", envName: "Development", status: "HEALTHY", agentVersion: "0.1.4", vectorVersion: "0.40.0", os: "darwin", baseLoad: 0.22 },
  { name: "vf-dev-canary", envName: "Development", status: "HEALTHY", agentVersion: "0.1.5-rc1", vectorVersion: "0.41.0-beta1", os: "linux", baseLoad: 0.41 },
  { name: "vf-dev-arm", envName: "Development", status: "HEALTHY", agentVersion: "0.1.4", vectorVersion: "0.40.0", os: "linux", baseLoad: 0.19 },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Sinusoidal traffic curve over the day (peaks in office hours) plus a
 * slow weekly trend plus noise. Returns a multiplier centered around 1.0.
 */
function trafficShape(t: Date): number {
  const hour = t.getHours() + t.getMinutes() / 60;
  const daily = 1 + 0.45 * Math.sin(((hour - 6) / 24) * 2 * Math.PI);
  const dow = t.getDay();
  const weekday = dow === 0 || dow === 6 ? 0.55 : 1.0;
  const noise = rand(0.85, 1.15);
  return clamp(daily * weekday * noise, 0.1, 2.0);
}

// ─── Wipe ───────────────────────────────────────────────────────────────────

async function wipeDemoData(): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: DEMO_USER_EMAIL },
    select: { id: true, memberships: { select: { teamId: true } } },
  });
  if (!user) return;
  const teamIds = user.memberships.map((m) => m.teamId);
  if (teamIds.length === 0) {
    await prisma.user.delete({ where: { id: user.id } });
    return;
  }

  console.log(`  wiping ${teamIds.length} demo team(s)...`);
  // Cascades from Team → Environment → VectorNode → NodeMetric, etc.
  // Pipeline → PipelineMetric, AnomalyEvent, CostRecommendation cascade.
  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { teamId: { in: teamIds } } }),
    prisma.team.deleteMany({ where: { id: { in: teamIds } } }),
    prisma.user.deleteMany({ where: { id: user.id } }),
  ]);
}

// ─── Build core entities ────────────────────────────────────────────────────

interface SeedContext {
  user: { id: string };
  team: { id: string };
  envByName: Map<string, { id: string; costPerGbCents: number }>;
  pipelines: Array<{
    id: string;
    name: string;
    envId: string;
    template: (typeof PIPELINE_TEMPLATES)[number];
  }>;
  nodes: Array<{
    id: string;
    name: string;
    envId: string;
    status: NodeStatus;
    baseLoad: number;
  }>;
}

async function buildCore(): Promise<SeedContext> {
  console.log("  creating user, team, environments...");

  // Singleton settings — leave defaults if exists
  await prisma.systemSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  const passwordHash = await bcrypt.hash(DEMO_USER_PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      email: DEMO_USER_EMAIL,
      name: "Demo User",
      passwordHash,
      authMethod: "LOCAL",
      isSuperAdmin: true,
      mustChangePassword: false,
    },
  });

  const team = await prisma.team.create({
    data: {
      name: DEMO_TEAM_NAME,
      members: { create: { userId: user.id, role: "ADMIN" } },
    },
  });

  const envByName = new Map<string, { id: string; costPerGbCents: number }>();
  for (const [name, costCents] of [
    ["Production", 12],
    ["Staging", 8],
    ["Development", 5],
  ] as const) {
    const env = await prisma.environment.create({
      data: { name, teamId: team.id, costPerGbCents: costCents, costBudgetCents: name === "Production" ? 250000 : null },
    });
    envByName.set(name, { id: env.id, costPerGbCents: costCents });
  }

  await prisma.team.update({
    where: { id: team.id },
    data: { defaultEnvironmentId: envByName.get("Production")!.id },
  });

  console.log("  creating pipelines (with nodes, edges, version)...");
  const pipelines: SeedContext["pipelines"] = [];
  for (const tpl of PIPELINE_TEMPLATES) {
    const env = envByName.get(tpl.envName)!;
    const pipeline = await prisma.pipeline.create({
      data: {
        name: tpl.name,
        description: tpl.description,
        environmentId: env.id,
        isDraft: false,
        deployedAt: new Date(NOW.getTime() - rand(1, 12) * 60 * 60 * 1000),
        createdById: user.id,
      },
    });

    const nodeIds: string[] = [];
    for (let i = 0; i < tpl.nodes.length; i++) {
      const n = tpl.nodes[i];
      const created = await prisma.pipelineNode.create({
        data: {
          pipelineId: pipeline.id,
          componentKey: n.componentKey,
          displayName: n.displayName,
          componentType: n.componentType,
          kind: n.kind,
          config: {},
          positionX: 100 + i * 280,
          positionY: 200,
        },
      });
      nodeIds.push(created.id);
    }
    for (let i = 0; i < nodeIds.length - 1; i++) {
      await prisma.pipelineEdge.create({
        data: {
          pipelineId: pipeline.id,
          sourceNodeId: nodeIds[i],
          targetNodeId: nodeIds[i + 1],
        },
      });
    }
    await prisma.pipelineVersion.create({
      data: {
        pipelineId: pipeline.id,
        version: 1,
        configYaml: `# ${tpl.name}\n# Demo pipeline — see src/lib/vector for full schemas.\n`,
        createdById: user.id,
      },
    });
    pipelines.push({ id: pipeline.id, name: tpl.name, envId: env.id, template: tpl });
  }

  console.log("  creating vector nodes...");
  const nodes: SeedContext["nodes"] = [];
  for (const t of NODE_TEMPLATES) {
    const env = envByName.get(t.envName)!;
    const node = await prisma.vectorNode.create({
      data: {
        name: t.name,
        host: `${t.name}.demo.internal`,
        environmentId: env.id,
        status: t.status,
        agentVersion: t.agentVersion,
        vectorVersion: t.vectorVersion,
        os: t.os,
        enrolledAt: new Date(NOW.getTime() - rand(2, 60) * 24 * 60 * 60 * 1000),
        lastHeartbeat: t.status === "UNREACHABLE" ? new Date(NOW.getTime() - 3 * 60 * 60 * 1000) : new Date(NOW.getTime() - rand(0, 90) * 1000),
        lastSeen: t.status === "UNREACHABLE" ? new Date(NOW.getTime() - 3 * 60 * 60 * 1000) : new Date(NOW.getTime() - rand(0, 90) * 1000),
      },
    });
    nodes.push({ id: node.id, name: t.name, envId: env.id, status: t.status, baseLoad: t.baseLoad });
  }

  return { user, team, envByName, pipelines, nodes };
}

// ─── Time-series ────────────────────────────────────────────────────────────

async function generatePipelineMetrics(ctx: SeedContext): Promise<void> {
  console.log(`  generating pipeline metrics (${DAYS} days, ${PIPELINE_METRIC_INTERVAL_MIN}m intervals)...`);
  const rows: Array<{
    pipelineId: string;
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

  for (const p of ctx.pipelines) {
    const tpl = p.template;
    for (let t = START.getTime(); t < NOW.getTime(); t += PIPELINE_METRIC_INTERVAL_MS) {
      const stamp = new Date(t);
      const shape = trafficShape(stamp);
      const eventsIn = Math.floor(tpl.baseEventsPerInterval * shape);
      const eventsOut = Math.floor(eventsIn * (1 - tpl.reductionRatio));
      const errorsTotal = Math.floor(eventsIn * tpl.errorRate * rand(0.5, 1.5));
      const eventsDiscarded = Math.max(0, eventsIn - eventsOut - errorsTotal);
      const bytesIn = BigInt(Math.floor(eventsIn * tpl.bytesPerEvent * rand(0.92, 1.08)));
      const bytesOut = BigInt(Math.floor(eventsOut * tpl.bytesPerEvent * 0.85 * rand(0.9, 1.1)));
      rows.push({
        pipelineId: p.id,
        timestamp: stamp,
        eventsIn: BigInt(eventsIn),
        eventsOut: BigInt(eventsOut),
        eventsDiscarded: BigInt(eventsDiscarded),
        errorsTotal: BigInt(errorsTotal),
        bytesIn,
        bytesOut,
        utilization: clamp(0.2 + 0.6 * shape * rand(0.7, 1.2), 0, 1),
        latencyMeanMs: 8 + shape * rand(2, 18),
      });
    }
  }

  // Chunked insert for a manageable transaction size.
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.pipelineMetric.createMany({ data: rows.slice(i, i + CHUNK) });
  }
  console.log(`    inserted ${rows.length} pipeline metric rows`);
}

async function generateNodeMetrics(ctx: SeedContext): Promise<void> {
  console.log(`  generating node metrics (${DAYS} days, ${NODE_METRIC_INTERVAL_MIN}m intervals)...`);
  const rows: Array<{
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

  const TOTAL_MEM = BigInt(16) * BigInt(1024) * BigInt(1024) * BigInt(1024); // 16GB
  const TOTAL_FS = BigInt(500) * BigInt(1024) * BigInt(1024) * BigInt(1024); // 500GB

  for (const n of ctx.nodes) {
    if (n.status === "UNREACHABLE") continue; // unreachable nodes don't report
    let cpuSecondsTotal = 0;
    let cpuSecondsIdle = 0;
    for (let t = START.getTime(); t < NOW.getTime(); t += NODE_METRIC_INTERVAL_MS) {
      const stamp = new Date(t);
      const shape = trafficShape(stamp);
      const load = clamp(n.baseLoad * shape * rand(0.8, 1.2), 0, 0.99);

      cpuSecondsTotal += (NODE_METRIC_INTERVAL_MS / 1000) * 4; // 4 cores
      cpuSecondsIdle += (NODE_METRIC_INTERVAL_MS / 1000) * 4 * (1 - load);

      const memUsed = BigInt(Math.floor(Number(TOTAL_MEM) * (0.35 + load * 0.4)));
      const fsUsed = BigInt(Math.floor(Number(TOTAL_FS) * (0.4 + rand(0, 0.15))));

      rows.push({
        nodeId: n.id,
        timestamp: stamp,
        memoryTotalBytes: TOTAL_MEM,
        memoryUsedBytes: memUsed,
        memoryFreeBytes: TOTAL_MEM - memUsed,
        cpuSecondsTotal,
        cpuSecondsIdle,
        loadAvg1: load * 4,
        loadAvg5: load * 4 * 0.95,
        loadAvg15: load * 4 * 0.9,
        fsTotalBytes: TOTAL_FS,
        fsUsedBytes: fsUsed,
        fsFreeBytes: TOTAL_FS - fsUsed,
        diskReadBytes: BigInt(Math.floor(rand(50_000, 5_000_000) * shape)),
        diskWrittenBytes: BigInt(Math.floor(rand(100_000, 8_000_000) * shape)),
        netRxBytes: BigInt(Math.floor(rand(500_000, 50_000_000) * shape)),
        netTxBytes: BigInt(Math.floor(rand(200_000, 30_000_000) * shape)),
      });
    }
  }

  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.nodeMetric.createMany({ data: rows.slice(i, i + CHUNK) });
  }
  console.log(`    inserted ${rows.length} node metric rows`);
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

async function generateAlerts(ctx: SeedContext): Promise<void> {
  console.log("  creating alert rules + events...");
  const prodEnv = ctx.envByName.get("Production")!;
  const stagingEnv = ctx.envByName.get("Staging")!;

  const rules = await Promise.all([
    prisma.alertRule.create({
      data: {
        name: "High CPU on production edge",
        environmentId: prodEnv.id,
        teamId: ctx.team.id,
        metric: "cpu_usage",
        condition: "gt",
        threshold: 75,
        durationSeconds: 300,
      },
    }),
    prisma.alertRule.create({
      data: {
        name: "Pipeline error rate > 1%",
        environmentId: prodEnv.id,
        teamId: ctx.team.id,
        metric: "error_rate",
        condition: "gt",
        threshold: 1,
        durationSeconds: 600,
      },
    }),
    prisma.alertRule.create({
      data: {
        name: "Node unreachable",
        environmentId: prodEnv.id,
        teamId: ctx.team.id,
        metric: "node_unreachable",
        durationSeconds: 120,
      },
    }),
    prisma.alertRule.create({
      data: {
        name: "Staging memory usage",
        environmentId: stagingEnv.id,
        teamId: ctx.team.id,
        metric: "memory_usage",
        condition: "gt",
        threshold: 80,
        durationSeconds: 300,
      },
    }),
    prisma.alertRule.create({
      data: {
        name: "New version available",
        environmentId: prodEnv.id,
        teamId: ctx.team.id,
        metric: "new_version_available",
      },
    }),
    prisma.alertRule.create({
      data: {
        name: "Backup failed",
        environmentId: prodEnv.id,
        teamId: ctx.team.id,
        metric: "backup_failed",
      },
    }),
  ]);

  const prodNodes = ctx.nodes.filter((n) => n.envId === prodEnv.id);
  const stagingNodes = ctx.nodes.filter((n) => n.envId === stagingEnv.id);

  const events: Array<Parameters<typeof prisma.alertEvent.create>[0]["data"]> = [];

  // 1 currently-firing CPU alert
  events.push({
    alertRuleId: rules[0].id,
    nodeId: prodNodes.find((n) => n.status === "DEGRADED")?.id ?? prodNodes[0].id,
    status: "firing",
    value: 87.4,
    message: "CPU > 75% for 5m",
    firedAt: new Date(NOW.getTime() - 18 * 60 * 1000),
  });
  // 1 currently-firing node unreachable
  const unreachable = stagingNodes.find((n) => n.status === "UNREACHABLE");
  if (unreachable) {
    events.push({
      alertRuleId: rules[2].id,
      nodeId: unreachable.id,
      status: "firing",
      value: 1,
      message: `Node ${unreachable.name} stopped responding`,
      firedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    });
  }
  // 5 resolved error-rate alerts spread over the past week
  for (let i = 0; i < 5; i++) {
    const fired = new Date(NOW.getTime() - rand(1, 7) * 24 * 60 * 60 * 1000);
    const resolved = new Date(fired.getTime() + rand(5, 40) * 60 * 1000);
    events.push({
      alertRuleId: rules[1].id,
      nodeId: prodNodes[Math.floor(Math.random() * prodNodes.length)].id,
      status: "resolved",
      value: 1 + rand(0.5, 2.5),
      message: "Error rate exceeded threshold",
      firedAt: fired,
      resolvedAt: resolved,
    });
  }
  // 2 acknowledged staging memory alerts
  for (let i = 0; i < 2; i++) {
    const fired = new Date(NOW.getTime() - rand(2, 10) * 24 * 60 * 60 * 1000);
    events.push({
      alertRuleId: rules[3].id,
      nodeId: stagingNodes[i % stagingNodes.length].id,
      status: "acknowledged",
      value: 80 + rand(2, 12),
      message: "Memory usage above 80%",
      firedAt: fired,
      acknowledgedAt: new Date(fired.getTime() + rand(2, 30) * 60 * 1000),
      acknowledgedBy: ctx.user.id,
    });
  }
  // 1 backup_failed event
  events.push({
    alertRuleId: rules[5].id,
    status: "resolved",
    value: 1,
    message: "Nightly backup failed: S3 timeout",
    firedAt: new Date(NOW.getTime() - 36 * 60 * 60 * 1000),
    resolvedAt: new Date(NOW.getTime() - 35 * 60 * 60 * 1000),
  });

  for (const data of events) {
    await prisma.alertEvent.create({ data });
  }
  console.log(`    created ${rules.length} rules + ${events.length} events`);
}

// ─── Anomalies ──────────────────────────────────────────────────────────────

async function generateAnomalies(ctx: SeedContext): Promise<void> {
  console.log("  generating anomaly events...");
  const types = ["throughput_drop", "throughput_spike", "error_rate_spike", "latency_spike"] as const;
  const severities = ["info", "warning", "critical"] as const;
  const metrics = ["eventsIn", "errorsTotal", "latencyMeanMs"] as const;

  let count = 0;
  for (let i = 0; i < 14; i++) {
    const p = ctx.pipelines[Math.floor(Math.random() * ctx.pipelines.length)];
    const ty = types[Math.floor(Math.random() * types.length)];
    const sev = severities[Math.floor(Math.random() * severities.length)];
    const metric = metrics[Math.floor(Math.random() * metrics.length)];
    const baseline = rand(1000, 50000);
    const stddev = baseline * rand(0.05, 0.2);
    const deviation = sev === "critical" ? rand(4, 8) : sev === "warning" ? rand(3, 4) : rand(2, 3);
    const direction = ty.includes("drop") ? -1 : 1;
    const current = baseline + direction * deviation * stddev;

    await prisma.anomalyEvent.create({
      data: {
        pipelineId: p.id,
        environmentId: p.envId,
        teamId: ctx.team.id,
        anomalyType: ty,
        severity: sev,
        metricName: metric,
        currentValue: current,
        baselineMean: baseline,
        baselineStddev: stddev,
        deviationFactor: deviation,
        message: `${metric} ${ty.replace("_", " ")} on ${p.name}`,
        status: i < 3 ? "open" : i < 8 ? "acknowledged" : "dismissed",
        detectedAt: new Date(NOW.getTime() - rand(0.1, DAYS) * 24 * 60 * 60 * 1000),
        acknowledgedAt: i >= 3 && i < 8 ? new Date(NOW.getTime() - rand(1, 5) * 60 * 60 * 1000) : null,
        acknowledgedBy: i >= 3 && i < 8 ? ctx.user.id : null,
        dismissedAt: i >= 8 ? new Date(NOW.getTime() - rand(1, 24) * 60 * 60 * 1000) : null,
        dismissedBy: i >= 8 ? ctx.user.id : null,
      },
    });
    count++;
  }
  console.log(`    created ${count} anomaly events`);
}

// ─── Cost recommendations ───────────────────────────────────────────────────

async function generateCostRecommendations(ctx: SeedContext): Promise<void> {
  console.log("  generating cost recommendations...");
  const candidates = ctx.pipelines.slice(0, 5);
  for (const p of candidates) {
    await prisma.costRecommendation.create({
      data: {
        teamId: ctx.team.id,
        environmentId: p.envId,
        pipelineId: p.id,
        type: p.template.reductionRatio < 0.1 ? "LOW_REDUCTION" : "HIGH_ERROR_RATE",
        status: "PENDING",
        title: p.template.reductionRatio < 0.1 ? `${p.name} drops less than 10% of bytes` : `${p.name} error rate above 1%`,
        description: p.template.reductionRatio < 0.1
          ? "Most ingested events are passed through without filtering. Consider adding a sampling or filter transform."
          : "Sustained error rate is producing spikes that may indicate downstream backpressure.",
        analysisData: {
          last7Days: { reductionPercent: p.template.reductionRatio * 100, errorRate: p.template.errorRate * 100 },
        },
        estimatedSavingsBytes: BigInt(Math.floor(rand(1_000_000_000, 50_000_000_000))),
        expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }
  console.log(`    created ${candidates.length} cost recommendations`);
}

// ─── Status events ──────────────────────────────────────────────────────────

async function generateNodeStatusEvents(ctx: SeedContext): Promise<void> {
  console.log("  generating node status events...");
  for (const n of ctx.nodes) {
    await prisma.nodeStatusEvent.create({
      data: {
        nodeId: n.id,
        fromStatus: null,
        toStatus: "HEALTHY",
        reason: "enrolled",
      },
    });
    if (n.status === "DEGRADED") {
      await prisma.nodeStatusEvent.create({
        data: { nodeId: n.id, fromStatus: "HEALTHY", toStatus: "DEGRADED", reason: "elevated CPU" },
      });
    }
    if (n.status === "UNREACHABLE") {
      await prisma.nodeStatusEvent.create({
        data: { nodeId: n.id, fromStatus: "HEALTHY", toStatus: "UNREACHABLE", reason: "heartbeat timeout" },
      });
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.NEXT_PUBLIC_VF_DEMO_MODE !== "true") {
    console.error(
      "Refusing to run demo seed: NEXT_PUBLIC_VF_DEMO_MODE is not 'true'.\n" +
        "This script is destructive. Set NEXT_PUBLIC_VF_DEMO_MODE=true to confirm.",
    );
    process.exit(1);
  }

  console.log(`VectorFlow demo seed — ${DAYS} days, ${PIPELINE_TEMPLATES.length} pipelines, ${NODE_TEMPLATES.length} nodes`);
  await wipeDemoData();
  const ctx = await buildCore();
  await generatePipelineMetrics(ctx);
  await generateNodeMetrics(ctx);
  await generateAlerts(ctx);
  await generateAnomalies(ctx);
  await generateCostRecommendations(ctx);
  await generateNodeStatusEvents(ctx);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
