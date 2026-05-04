import { PrismaClient } from "../../src/generated/prisma";
import { hash } from "bcryptjs";
import { TEST_USER, TEST_TEAM, TEST_ENVIRONMENT, TEST_PIPELINE, TEST_NODE, TEST_ALERT_RULE } from "./constants";

export interface SeedResult {
  userId: string;
  teamId: string;
  environmentId: string;
  pipelineId: string;
  nodeId: string;
  alertRuleId: string;
  firingEventId: string;
  resolvedEventId: string;
  acknowledgedEventId: string;
}

export async function seed(prisma: PrismaClient): Promise<SeedResult> {
  const passwordHash = await hash(TEST_USER.password, 10);

  const user = await prisma.user.create({
    data: {
      email: TEST_USER.email,
      name: TEST_USER.name,
      passwordHash,
      authMethod: "LOCAL",
      totpEnabled: false,
      isSuperAdmin: false,
      mustChangePassword: false,
    },
  });

  const team = await prisma.team.create({
    data: { name: TEST_TEAM.name },
  });

  await prisma.teamMember.create({
    data: { userId: user.id, teamId: team.id, role: "ADMIN" },
  });

  const environment = await prisma.environment.create({
    data: {
      name: TEST_ENVIRONMENT.name,
      teamId: team.id,
      isSystem: false,
      costPerGbCents: 14,
      costBudgetCents: 2500,
    },
  });

  await prisma.team.update({
    where: { id: team.id },
    data: { defaultEnvironmentId: environment.id },
  });

  const pipeline = await prisma.pipeline.create({
    data: {
      name: TEST_PIPELINE.name,
      description: TEST_PIPELINE.description,
      environmentId: environment.id,
      isDraft: true,
      createdById: user.id,
    },
  });

  const sourceNode = await prisma.pipelineNode.create({
    data: {
      pipelineId: pipeline.id,
      componentKey: "demo_logs_source",
      displayName: "Demo Logs",
      componentType: "demo_logs",
      kind: "SOURCE",
      config: { format: "syslog", interval: 1 },
      positionX: 100,
      positionY: 200,
    },
  });

  const transformNode = await prisma.pipelineNode.create({
    data: {
      pipelineId: pipeline.id,
      componentKey: "remap_transform",
      displayName: "Remap",
      componentType: "remap",
      kind: "TRANSFORM",
      config: { source: ". = parse_syslog!(.message)" },
      positionX: 400,
      positionY: 200,
    },
  });

  const sinkNode = await prisma.pipelineNode.create({
    data: {
      pipelineId: pipeline.id,
      componentKey: "blackhole_sink",
      displayName: "Blackhole",
      componentType: "blackhole",
      kind: "SINK",
      config: { print_interval_secs: 1 },
      positionX: 700,
      positionY: 200,
    },
  });

  await prisma.pipelineEdge.createMany({
    data: [
      { pipelineId: pipeline.id, sourceNodeId: sourceNode.id, targetNodeId: transformNode.id },
      { pipelineId: pipeline.id, sourceNodeId: transformNode.id, targetNodeId: sinkNode.id },
    ],
  });

  await prisma.pipelineVersion.create({
    data: {
      pipelineId: pipeline.id,
      version: 1,
      configYaml: "# E2E test pipeline config",
      nodesSnapshot: [
        { id: sourceNode.id, componentKey: "demo_logs_source", kind: "SOURCE", componentType: "demo_logs", config: sourceNode.config, positionX: 100, positionY: 200 },
        { id: transformNode.id, componentKey: "remap_transform", kind: "TRANSFORM", componentType: "remap", config: transformNode.config, positionX: 400, positionY: 200 },
        { id: sinkNode.id, componentKey: "blackhole_sink", kind: "SINK", componentType: "blackhole", config: sinkNode.config, positionX: 700, positionY: 200 },
      ],
      edgesSnapshot: [
        { sourceNodeId: sourceNode.id, targetNodeId: transformNode.id },
        { sourceNodeId: transformNode.id, targetNodeId: sinkNode.id },
      ],
      createdById: user.id,
    },
  });

  const node = await prisma.vectorNode.create({
    data: {
      name: TEST_NODE.name,
      host: TEST_NODE.host,
      apiPort: TEST_NODE.apiPort,
      environmentId: environment.id,
      status: "HEALTHY",
      lastSeen: new Date(),
      agentVersion: "1.0.0",
      vectorVersion: "0.42.0",
      os: "linux",
      deploymentMode: "STANDALONE",
      labels: { env: "e2e", region: "test" },
    },
  });

  const driftedNode = await prisma.vectorNode.create({
    data: {
      name: "e2e-node-02-drift",
      host: "e2e-host-02.local",
      apiPort: 8687,
      environmentId: environment.id,
      status: "DEGRADED",
      lastSeen: new Date(Date.now() - 45 * 60_000),
      agentVersion: "0.9.5",
      vectorVersion: "0.41.1",
      os: "linux",
      deploymentMode: "STANDALONE",
      labels: { env: "e2e", region: "test", drift: "version" },
    },
  });

  await prisma.nodePipelineStatus.createMany({
    data: [
      {
        nodeId: node.id,
        pipelineId: pipeline.id,
        version: 1,
        status: "RUNNING",
        pid: 4201,
        uptimeSeconds: 86_400,
        eventsIn: BigInt(2_400_000),
        eventsOut: BigInt(2_352_000),
        errorsTotal: BigInt(340),
        eventsDiscarded: BigInt(4_800),
        bytesIn: BigInt(1_200_000_000),
        bytesOut: BigInt(1_050_000_000),
        utilization: 0.62,
        configChecksum: "pipeline-v1-current",
        recentLogs: [
          { level: "INFO", message: "Pipeline running normally" },
          { level: "WARN", message: "Recovered from short output backpressure" },
        ],
        lastUpdated: new Date(),
      },
      {
        nodeId: driftedNode.id,
        pipelineId: pipeline.id,
        version: 0,
        status: "RUNNING",
        pid: 4202,
        uptimeSeconds: 72_000,
        eventsIn: BigInt(1_850_000),
        eventsOut: BigInt(1_720_000),
        errorsTotal: BigInt(1_240),
        eventsDiscarded: BigInt(22_000),
        bytesIn: BigInt(940_000_000),
        bytesOut: BigInt(790_000_000),
        utilization: 0.88,
        configChecksum: "pipeline-v0-drifted",
        recentLogs: [
          { level: "WARN", message: "Running older pipeline version" },
          { level: "ERROR", message: "Intermittent sink delivery failures" },
        ],
        lastUpdated: new Date(Date.now() - 45 * 60_000),
      },
    ],
  });

  await prisma.nodeStatusEvent.createMany({
    data: [
      {
        nodeId: node.id,
        fromStatus: null,
        toStatus: "HEALTHY",
        reason: "e2e seed enrollment",
        timestamp: new Date(Date.now() - 48 * 3600_000),
      },
      {
        nodeId: driftedNode.id,
        fromStatus: "HEALTHY",
        toStatus: "DEGRADED",
        reason: "version drift detected",
        timestamp: new Date(Date.now() - 6 * 3600_000),
      },
      {
        nodeId: node.id,
        fromStatus: "DEGRADED",
        toStatus: "HEALTHY",
        reason: "missing metrics recovered",
        timestamp: new Date(Date.now() - 3 * 3600_000),
      },
    ],
  });

  await prisma.nodeMetric.createMany({
    data: buildNodeMetricHistory(node.id, driftedNode.id),
  });

  await prisma.pipelineMetric.createMany({
    data: buildPipelineMetricHistory(pipeline.id, node.id, driftedNode.id, sourceNode.id),
  });

  const alertRule = await prisma.alertRule.create({
    data: {
      name: TEST_ALERT_RULE.name,
      enabled: true,
      environmentId: environment.id,
      pipelineId: pipeline.id,
      teamId: team.id,
      metric: "error_rate",
      condition: "gt",
      threshold: 5.0,
      durationSeconds: 60,
    },
  });

  const costAlertRule = await prisma.alertRule.create({
    data: {
      name: "E2E Cost Budget",
      enabled: true,
      environmentId: environment.id,
      pipelineId: pipeline.id,
      teamId: team.id,
      metric: "cost_threshold_exceeded",
      condition: "gt",
      threshold: 25.0,
      durationSeconds: 0,
    },
  });

  await prisma.alertRule.create({
    data: {
      name: "E2E Version Drift",
      enabled: true,
      environmentId: environment.id,
      teamId: team.id,
      metric: "version_drift",
      condition: "gt",
      threshold: 0,
      durationSeconds: 0,
    },
  });

  await prisma.notificationChannel.create({
    data: {
      environmentId: environment.id,
      name: "E2E Slack Channel",
      type: "slack",
      config: { webhookUrl: "https://hooks.slack.example.com/e2e" },
      enabled: true,
    },
  });

  const firingEvent = await prisma.alertEvent.create({
    data: {
      alertRuleId: alertRule.id,
      nodeId: node.id,
      status: "firing",
      value: 12.5,
      message: "Error rate exceeded threshold: 12.5% > 5.0%",
      firedAt: new Date(),
    },
  });

  const resolvedEvent = await prisma.alertEvent.create({
    data: {
      alertRuleId: alertRule.id,
      nodeId: node.id,
      status: "resolved",
      value: 2.1,
      message: "Error rate returned to normal: 2.1%",
      firedAt: new Date(Date.now() - 3600_000),
      resolvedAt: new Date(Date.now() - 1800_000),
    },
  });

  const acknowledgedEvent = await prisma.alertEvent.create({
    data: {
      alertRuleId: alertRule.id,
      nodeId: node.id,
      status: "acknowledged",
      value: 8.3,
      message: "Error rate exceeded threshold: 8.3% > 5.0%",
      firedAt: new Date(Date.now() - 7200_000),
      acknowledgedAt: new Date(Date.now() - 6000_000),
      acknowledgedBy: TEST_USER.email,
    },
  });

  await prisma.alertEvent.create({
    data: {
      alertRuleId: alertRule.id,
      nodeId: driftedNode.id,
      status: "firing",
      value: 18.9,
      message: "Noisy error burst on drifted node: 18.9% > 5.0%",
      firedAt: new Date(Date.now() - 30 * 3600_000),
    },
  });

  await prisma.alertEvent.create({
    data: {
      alertRuleId: alertRule.id,
      nodeId: driftedNode.id,
      status: "resolved",
      value: 1.8,
      message: "Noisy error burst recovered: 1.8%",
      firedAt: new Date(Date.now() - 29 * 3600_000),
      resolvedAt: new Date(Date.now() - 28 * 3600_000),
    },
  });

  await prisma.alertEvent.create({
    data: {
      alertRuleId: costAlertRule.id,
      nodeId: node.id,
      status: "firing",
      value: 27.4,
      message: "Monthly processing cost exceeded e2e budget: $27.40 > $25.00",
      firedAt: new Date(Date.now() - 90 * 60_000),
    },
  });

  return {
    userId: user.id,
    teamId: team.id,
    environmentId: environment.id,
    pipelineId: pipeline.id,
    nodeId: node.id,
    alertRuleId: alertRule.id,
    firingEventId: firingEvent.id,
    resolvedEventId: resolvedEvent.id,
    acknowledgedEventId: acknowledgedEvent.id,
  };
}

function buildNodeMetricHistory(primaryNodeId: string, driftedNodeId: string) {
  const rows = [];

  for (const hoursAgo of metricHoursAgo()) {
    rows.push(buildNodeMetric(primaryNodeId, hoursAgo, 0.54));
    rows.push(buildNodeMetric(driftedNodeId, hoursAgo, hoursAgo < 12 ? 0.83 : 0.68));
  }

  return rows;
}

function buildNodeMetric(nodeId: string, hoursAgo: number, pressure: number) {
  const memoryTotal = 8_589_934_592;
  const memoryUsed = Math.round(memoryTotal * pressure);
  const counterBase = (48 - hoursAgo) * 60;

  return {
    nodeId,
    timestamp: hoursAgoDate(hoursAgo),
    memoryTotalBytes: BigInt(memoryTotal),
    memoryUsedBytes: BigInt(memoryUsed),
    memoryFreeBytes: BigInt(memoryTotal - memoryUsed),
    cpuSecondsTotal: counterBase * 120,
    cpuSecondsIdle: counterBase * (pressure > 0.8 ? 28 : 74),
    loadAvg1: pressure > 0.8 ? 3.8 : 1.2,
    loadAvg5: pressure > 0.8 ? 3.1 : 1.0,
    loadAvg15: pressure > 0.8 ? 2.6 : 0.8,
    fsTotalBytes: BigInt(107_374_182_400),
    fsUsedBytes: BigInt(Math.round(107_374_182_400 * (0.45 + pressure / 10))),
    fsFreeBytes: BigInt(Math.round(107_374_182_400 * (0.55 - pressure / 10))),
    diskReadBytes: BigInt(counterBase * 1_250_000),
    diskWrittenBytes: BigInt(counterBase * 900_000),
    netRxBytes: BigInt(counterBase * 2_500_000),
    netTxBytes: BigInt(counterBase * 2_100_000),
  };
}

function buildPipelineMetricHistory(
  pipelineId: string,
  primaryNodeId: string,
  driftedNodeId: string,
  sourceComponentId: string,
) {
  const rows = [];

  for (const hoursAgo of metricHoursAgo()) {
    const isNoisyWindow = hoursAgo >= 27 && hoursAgo <= 30;
    const isRecentRecovery = hoursAgo <= 3;
    const primaryEvents = isRecentRecovery ? 68_000 : 52_000;
    const driftedEvents = isNoisyWindow ? 39_000 : 31_000;
    const primaryErrors = isNoisyWindow ? 1_250 : isRecentRecovery ? 40 : 180;
    const driftedErrors = isNoisyWindow ? 3_400 : 820;

    rows.push(buildPipelineMetric({
      pipelineId,
      nodeId: primaryNodeId,
      componentId: sourceComponentId,
      hoursAgo,
      eventsIn: primaryEvents,
      errorsTotal: primaryErrors,
      utilization: isRecentRecovery ? 0.48 : 0.61,
      latencyMeanMs: isRecentRecovery ? 38 : 74,
    }));
    rows.push(buildPipelineMetric({
      pipelineId,
      nodeId: driftedNodeId,
      componentId: sourceComponentId,
      hoursAgo,
      eventsIn: driftedEvents,
      errorsTotal: driftedErrors,
      utilization: isNoisyWindow ? 0.94 : 0.79,
      latencyMeanMs: isNoisyWindow ? 220 : 105,
    }));
    rows.push(buildPipelineMetric({
      pipelineId,
      nodeId: null,
      componentId: null,
      hoursAgo,
      eventsIn: primaryEvents + driftedEvents,
      errorsTotal: primaryErrors + driftedErrors,
      utilization: isNoisyWindow ? 0.86 : 0.66,
      latencyMeanMs: isNoisyWindow ? 171 : 86,
    }));
  }

  return rows;
}

function buildPipelineMetric(input: {
  pipelineId: string;
  nodeId: string | null;
  componentId: string | null;
  hoursAgo: number;
  eventsIn: number;
  errorsTotal: number;
  utilization: number;
  latencyMeanMs: number;
}) {
  const eventsOut = Math.round(input.eventsIn * 0.97);
  const discarded = Math.max(0, Math.round(input.eventsIn * 0.006));
  const bytesIn = input.eventsIn * 850;
  const bytesOut = eventsOut * 760;

  return {
    pipelineId: input.pipelineId,
    nodeId: input.nodeId,
    componentId: input.componentId,
    timestamp: hoursAgoDate(input.hoursAgo),
    eventsIn: BigInt(input.eventsIn),
    eventsOut: BigInt(eventsOut),
    eventsDiscarded: BigInt(discarded),
    errorsTotal: BigInt(input.errorsTotal),
    bytesIn: BigInt(bytesIn),
    bytesOut: BigInt(bytesOut),
    utilization: input.utilization,
    latencyMeanMs: input.latencyMeanMs,
  };
}

function metricHoursAgo() {
  const hours = [];
  for (let hour = 48; hour >= 0; hour -= 1) {
    if (hour >= 18 && hour <= 23) continue;
    hours.push(hour);
  }
  return hours;
}

function hoursAgoDate(hours: number) {
  return new Date(Date.now() - hours * 3600_000);
}
