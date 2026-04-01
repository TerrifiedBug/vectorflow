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
    data: { name: TEST_ENVIRONMENT.name, teamId: team.id, isSystem: false },
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
