import type { PrismaClient } from "@/generated/prisma";
import { QA_DEV_USER } from "@/lib/dev-auth-bypass";

const QA_ENVIRONMENTS = ["qa-env-prod", "qa-env-staging", "qa-env-dev", "qa-env"];
const QA_PIPELINES = [
  "qa-pipe-k8s-logs-s3",
  "qa-pipe-auth-elastic",
  "qa-pipe-metrics-aggregator",
  "qa-pipe-syslog-loki",
  "qa-pipe-app-clickhouse",
  "qa-pipe-audit-splunk",
  "qa-pipe-dev-firehose",
  "qa-pipe-trace-tempo",
  "qa-pipeline",
];
const QA_VECTOR_NODES = [
  "qa-node-prod-edge-01",
  "qa-node-prod-edge-02",
  "qa-node-prod-edge-03",
  "qa-node-prod-aggregator-01",
  "qa-node-prod-aggregator-02",
  "qa-node-staging-01",
  "qa-node-staging-02",
  "qa-node-staging-03",
  "qa-node-staging-04",
  "qa-node-dev-laptop",
  "qa-node-dev-canary",
  "qa-node-dev-arm",
  "qa-vector-node",
];
const QA_TEMPLATES = ["qa-template-k8s", "qa-template-audit", "qa-template-traces"];
const QA_SECRETS = [
  "qa-secret-s3-archive-key",
  "qa-secret-elastic-api-key",
  "qa-secret-clickhouse-password",
  "qa-secret-splunk-hec-token",
  "qa-secret-tempo-token",
];
const QA_SERVICE_ACCOUNTS = ["qa-sa-ci-bot", "qa-sa-analytics"];
const QA_NOTIFICATION_CHANNELS = ["qa-channel-slack", "qa-channel-pagerduty"];
const QA_ALERT_RULES = [
  "qa-alert-cpu-prod",
  "qa-alert-error-prod",
  "qa-alert-node-unreachable",
  "qa-alert-memory-staging",
  "qa-alert-backup-failed",
  "qa-alert-version-drift",
];
const QA_CORRELATION_GROUPS = ["qa-corr-prod-cpu", "qa-corr-staging-node"];
const QA_MIGRATION_PROJECTS = ["qa-migration-fluentd", "qa-migration-vector-import"];
const QA_PROMOTIONS = [
  "qa-promo-pending",
  "qa-promo-approved",
  "qa-promo-deploying",
  "qa-promo-deployed",
  "qa-promo-rejected",
];

export const QA_IDS = {
  user: QA_DEV_USER.id,
  team: "qa-team",
  environment: QA_ENVIRONMENTS[0]!,
  pipeline: QA_PIPELINES[0]!,
  vectorNode: QA_VECTOR_NODES[0]!,
  environments: QA_ENVIRONMENTS,
  pipelines: QA_PIPELINES,
  vectorNodes: QA_VECTOR_NODES,
  templates: QA_TEMPLATES,
  secrets: QA_SECRETS,
  serviceAccounts: QA_SERVICE_ACCOUNTS,
  notificationChannels: QA_NOTIFICATION_CHANNELS,
  alertRules: QA_ALERT_RULES,
  correlationGroups: QA_CORRELATION_GROUPS,
  migrationProjects: QA_MIGRATION_PROJECTS,
  promotions: QA_PROMOTIONS,
} as const;

export async function resetQaSeed(prisma: PrismaClient) {
  await prisma.team.updateMany({
    where: { id: QA_IDS.team },
    data: { defaultEnvironmentId: null },
  });

  const qaPipelines = (await prisma.pipeline.findMany({
    where: {
      OR: [
        { id: { in: QA_IDS.pipelines } },
        { environmentId: { in: QA_IDS.environments } },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaPipelineIds = qaPipelines.map((pipeline) => pipeline.id);

  const qaNodes = (await prisma.vectorNode.findMany({
    where: {
      OR: [
        { id: { in: QA_IDS.vectorNodes } },
        { environmentId: { in: QA_IDS.environments } },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaNodeIds = qaNodes.map((node) => node.id);

  const qaPromotionRequests = (await prisma.release.findMany({
    where: {
      strategy: "PROMOTION",
      OR: [
        { id: { in: QA_IDS.promotions } },
        { environmentId: { in: QA_IDS.environments } },
        { targetEnvironmentId: { in: QA_IDS.environments } },
        { pipelineId: { in: qaPipelineIds } },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaPromotionIds = qaPromotionRequests.map((promotion) => promotion.id);

  const qaAlertRules = (await prisma.alertRule.findMany({
    where: {
      OR: [
        { id: { in: QA_IDS.alertRules } },
        { environmentId: { in: QA_IDS.environments } },
        { teamId: QA_IDS.team },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaAlertRuleIds = qaAlertRules.map((rule) => rule.id);

  const qaChannels = (await prisma.notificationChannel.findMany({
    where: {
      OR: [
        { id: { in: QA_IDS.notificationChannels } },
        { environmentId: { in: QA_IDS.environments } },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaChannelIds = qaChannels.map((channel) => channel.id);

  const qaCorrelationGroups = (await prisma.alertCorrelationGroup.findMany({
    where: {
      OR: [
        { id: { in: QA_IDS.correlationGroups } },
        { environmentId: { in: QA_IDS.environments } },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaCorrelationGroupIds = qaCorrelationGroups.map((group) => group.id);

  const qaServiceAccounts = (await prisma.serviceAccount.findMany({
    where: { environmentId: { in: QA_IDS.environments } },
    select: { id: true },
  })) ?? [];
  const qaServiceAccountIds = qaServiceAccounts.map((account) => account.id);

  const qaTemplates = (await prisma.template.findMany({
    where: {
      OR: [
        { id: { in: QA_IDS.templates } },
        { teamId: QA_IDS.team },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaTemplateIds = qaTemplates.map((template) => template.id);

  const qaSecrets = (await prisma.secret.findMany({
    where: { environmentId: { in: QA_IDS.environments } },
    select: { id: true },
  })) ?? [];
  const qaSecretIds = qaSecrets.map((secret) => secret.id);

  const qaAnomalyEvents = (await prisma.anomalyEvent.findMany({
    where: {
      OR: [
        { environmentId: { in: QA_IDS.environments } },
        { pipelineId: { in: qaPipelineIds } },
        { teamId: QA_IDS.team },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaAnomalyEventIds = qaAnomalyEvents.map((event) => event.id);

  const qaAlertEvents = (await prisma.alertEvent.findMany({
    where: {
      OR: [
        { alertRuleId: { in: qaAlertRuleIds } },
        { nodeId: { in: qaNodeIds } },
        { correlationGroupId: { in: qaCorrelationGroupIds } },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaAlertEventIds = qaAlertEvents.map((event) => event.id);

  const qaGitSyncJobs = (await prisma.gitSyncJob.findMany({
    where: {
      OR: [
        { environmentId: { in: QA_IDS.environments } },
        { pipelineId: { in: qaPipelineIds } },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaGitSyncJobIds = qaGitSyncJobs.map((job) => job.id);

  const qaMigrationProjects = (await prisma.migrationProject.findMany({
    where: {
      OR: [
        { id: { in: QA_IDS.migrationProjects } },
        { teamId: QA_IDS.team },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaMigrationProjectIds = qaMigrationProjects.map((project) => project.id);

  const qaCostRecommendations = (await prisma.costRecommendation.findMany({
    where: {
      OR: [
        { environmentId: { in: QA_IDS.environments } },
        { pipelineId: { in: qaPipelineIds } },
        { teamId: QA_IDS.team },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaCostRecommendationIds = qaCostRecommendations.map((recommendation) => recommendation.id);

  const qaAuditLogs = (await prisma.auditLog.findMany({
    where: {
      OR: [
        { teamId: QA_IDS.team },
        { userId: QA_IDS.user },
        { environmentId: { in: QA_IDS.environments } },
        { entityId: { in: [...QA_IDS.environments, ...qaPipelineIds, ...qaNodeIds, ...qaAlertRuleIds, ...qaPromotionIds, QA_IDS.team] } },
      ],
    },
    select: { id: true },
  })) ?? [];
  const qaAuditLogIds = qaAuditLogs.map((entry) => entry.id);


  await prisma.activeTap.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.eventSample.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.eventSampleRequest.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.pipelineLog.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.nodeStatusEvent.deleteMany({ where: { nodeId: { in: qaNodeIds } } });
  await prisma.nodeMetric.deleteMany({ where: { nodeId: { in: qaNodeIds } } });
  await prisma.pipelineSli.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.aiConversation.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.pipelineDependency.deleteMany({
    where: {
      OR: [
        { upstreamId: { in: qaPipelineIds } },
        { downstreamId: { in: qaPipelineIds } },
      ],
    },
  });
  await prisma.release.deleteMany({
    where: {
      strategy: "PROMOTION",
      OR: [
        { id: { in: qaPromotionIds } },
        { environmentId: { in: QA_IDS.environments } },
        { targetEnvironmentId: { in: QA_IDS.environments } },
        { pipelineId: { in: qaPipelineIds } },
      ],
    },
  });
  await prisma.release.deleteMany({
    where: {
      strategy: "DIRECT",
      OR: [
        { environmentId: { in: QA_IDS.environments } },
        { pipelineId: { in: qaPipelineIds } },
      ],
    },
  });
  await prisma.gitSyncJob.deleteMany({
    where: {
      OR: [
        { environmentId: { in: QA_IDS.environments } },
        { pipelineId: { in: qaPipelineIds } },
      ],
    },
  });
  await prisma.costRecommendation.deleteMany({
    where: {
      OR: [
        { environmentId: { in: QA_IDS.environments } },
        { pipelineId: { in: qaPipelineIds } },
        { teamId: QA_IDS.team },
      ],
    },
  });
  await prisma.deliveryAttempt.deleteMany({
    where: { alertEventId: { in: qaAlertEventIds } },
  });
  await prisma.alertEvent.deleteMany({
    where: {
      OR: [
        { alertRuleId: { in: qaAlertRuleIds } },
        { nodeId: { in: qaNodeIds } },
        { correlationGroupId: { in: qaCorrelationGroupIds } },
      ],
    },
  });
  await prisma.anomalyEvent.deleteMany({
    where: {
      OR: [
        { environmentId: { in: QA_IDS.environments } },
        { pipelineId: { in: qaPipelineIds } },
        { teamId: QA_IDS.team },
      ],
    },
  });
  await prisma.alertCorrelationGroup.deleteMany({
    where: {
      OR: [
        { id: { in: qaCorrelationGroupIds } },
        { environmentId: { in: QA_IDS.environments } },
      ],
    },
  });
  await prisma.alertRuleChannel.deleteMany({
    where: {
      OR: [
        { alertRuleId: { in: qaAlertRuleIds } },
        { channelId: { in: qaChannelIds } },
      ],
    },
  });
  await prisma.alertRule.deleteMany({
    where: {
      OR: [
        { id: { in: qaAlertRuleIds } },
        { environmentId: { in: QA_IDS.environments } },
        { teamId: QA_IDS.team },
      ],
    },
  });
  await prisma.notificationChannel.deleteMany({
    where: {
      OR: [
        { id: { in: qaChannelIds } },
        { environmentId: { in: QA_IDS.environments } },
      ],
    },
  });
  await prisma.sharedComponent.deleteMany({ where: { environmentId: { in: QA_IDS.environments } } });
  await prisma.filterPreset.deleteMany({ where: { environmentId: { in: QA_IDS.environments } } });
  await prisma.release.deleteMany({
    where: {
      strategy: "CANARY",
      OR: [
        { environmentId: { in: QA_IDS.environments } },
        { pipelineId: { in: qaPipelineIds } },
      ],
    },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { id: { in: qaAuditLogIds } },
        { environmentId: { in: QA_IDS.environments } },
        { entityId: { in: [...QA_IDS.environments, ...qaPipelineIds, ...qaNodeIds, ...qaAlertRuleIds, ...qaPromotionIds, QA_IDS.team] } },
      ],
    },
  });
  await prisma.pipelineEdge.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.pipelineNode.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.pipelineVersion.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.nodePipelineStatus.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.pipelineMetric.deleteMany({ where: { pipelineId: { in: qaPipelineIds } } });
  await prisma.serviceAccount.deleteMany({ where: { id: { in: qaServiceAccountIds } } });
  await prisma.secret.deleteMany({ where: { id: { in: qaSecretIds } } });
  await prisma.template.deleteMany({
    where: {
      OR: [
        { id: { in: qaTemplateIds } },
        { teamId: QA_IDS.team },
      ],
    },
  });
  await prisma.migrationProject.deleteMany({
    where: {
      OR: [
        { id: { in: qaMigrationProjectIds } },
        { teamId: QA_IDS.team },
      ],
    },
  });
  await prisma.pipeline.deleteMany({ where: { id: { in: qaPipelineIds } } });
  await prisma.vectorNode.deleteMany({ where: { id: { in: qaNodeIds } } });
  await prisma.environment.deleteMany({ where: { id: { in: QA_IDS.environments } } });
  await prisma.teamMember.deleteMany({ where: { teamId: QA_IDS.team } });
  await prisma.team.deleteMany({ where: { id: QA_IDS.team } });
  await prisma.user.deleteMany({ where: { id: QA_IDS.user } });
}
