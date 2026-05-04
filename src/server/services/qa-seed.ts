import type { PrismaClient } from "@/generated/prisma";
import { QA_DEV_USER } from "@/lib/dev-auth-bypass";

export const QA_IDS = {
  user: QA_DEV_USER.id,
  team: "qa-team",
  environment: "qa-env",
  pipeline: "qa-pipeline",
  sourceNode: "qa-node-source",
  sinkNode: "qa-node-sink",
  vectorNode: "qa-vector-node",
} as const;

export async function resetQaSeed(prisma: PrismaClient) {
  await prisma.team.updateMany({
    where: { id: QA_IDS.team },
    data: { defaultEnvironmentId: null },
  });

  await prisma.activeTap.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.eventSample.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.eventSampleRequest.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.pipelineLog.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.nodeStatusEvent.deleteMany({ where: { nodeId: QA_IDS.vectorNode } });
  await prisma.nodeMetric.deleteMany({ where: { nodeId: QA_IDS.vectorNode } });
  await prisma.pipelineSli.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.aiConversation.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.pipelineDependency.deleteMany({
    where: {
      OR: [{ upstreamId: QA_IDS.pipeline }, { downstreamId: QA_IDS.pipeline }],
    },
  });
  await prisma.deployRequest.deleteMany({
    where: {
      OR: [{ environmentId: QA_IDS.environment }, { pipelineId: QA_IDS.pipeline }],
    },
  });
  await prisma.gitSyncJob.deleteMany({
    where: {
      OR: [{ environmentId: QA_IDS.environment }, { pipelineId: QA_IDS.pipeline }],
    },
  });
  await prisma.costRecommendation.deleteMany({
    where: {
      OR: [
        { environmentId: QA_IDS.environment },
        { pipelineId: QA_IDS.pipeline },
        { teamId: QA_IDS.team },
      ],
    },
  });
  await prisma.anomalyEvent.deleteMany({
    where: {
      OR: [
        { environmentId: QA_IDS.environment },
        { pipelineId: QA_IDS.pipeline },
        { teamId: QA_IDS.team },
      ],
    },
  });
  await prisma.alertCorrelationGroup.deleteMany({
    where: { environmentId: QA_IDS.environment },
  });
  await prisma.sharedComponent.deleteMany({ where: { environmentId: QA_IDS.environment } });
  await prisma.filterPreset.deleteMany({ where: { environmentId: QA_IDS.environment } });
  await prisma.stagedRollout.deleteMany({
    where: {
      OR: [{ environmentId: QA_IDS.environment }, { pipelineId: QA_IDS.pipeline }],
    },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { teamId: QA_IDS.team },
        { environmentId: QA_IDS.environment },
        { entityId: { in: [QA_IDS.team, QA_IDS.environment, QA_IDS.pipeline, QA_IDS.vectorNode] } },
      ],
    },
  });

  await prisma.pipelineEdge.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.pipelineNode.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.pipelineVersion.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.nodePipelineStatus.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.pipelineMetric.deleteMany({ where: { pipelineId: QA_IDS.pipeline } });
  await prisma.pipeline.deleteMany({ where: { id: QA_IDS.pipeline } });
  await prisma.vectorNode.deleteMany({ where: { id: QA_IDS.vectorNode } });
  await prisma.notificationChannel.deleteMany({ where: { environmentId: QA_IDS.environment } });
  await prisma.environment.deleteMany({ where: { id: QA_IDS.environment } });
  await prisma.teamMember.deleteMany({ where: { teamId: QA_IDS.team } });
  await prisma.team.deleteMany({ where: { id: QA_IDS.team } });
  await prisma.user.deleteMany({ where: { id: QA_IDS.user } });
}
