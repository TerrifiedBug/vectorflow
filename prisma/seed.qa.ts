import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma";
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
      totpEnabled: false,
      isSuperAdmin: false,
      mustChangePassword: false,
    },
  });

  await prisma.team.create({
    data: {
      id: QA_IDS.team,
      name: "QA Dev Workspace",
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

  await prisma.environment.create({
    data: {
      id: QA_IDS.environment,
      name: "qa-dev",
      teamId: QA_IDS.team,
      isSystem: false,
      enrollmentTokenHash: enrollmentToken.hash,
      enrollmentTokenHint: enrollmentToken.hint,
    },
  });

  await prisma.team.update({
    where: { id: QA_IDS.team },
    data: { defaultEnvironmentId: QA_IDS.environment },
  });

  await prisma.pipeline.create({
    data: {
      id: QA_IDS.pipeline,
      name: "QA Seed Pipeline",
      description: "Seeded pipeline for browser-based QA verification",
      environmentId: QA_IDS.environment,
      isDraft: true,
      createdById: QA_IDS.user,
      updatedById: QA_IDS.user,
    },
  });

  await prisma.pipelineNode.createMany({
    data: [
      {
        id: QA_IDS.sourceNode,
        pipelineId: QA_IDS.pipeline,
        componentKey: "qa_demo_logs",
        displayName: "QA Demo Logs",
        componentType: "demo_logs",
        kind: "SOURCE",
        config: { format: "syslog", interval: 1 },
        positionX: 120,
        positionY: 200,
      },
      {
        id: QA_IDS.sinkNode,
        pipelineId: QA_IDS.pipeline,
        componentKey: "qa_blackhole",
        displayName: "QA Blackhole",
        componentType: "blackhole",
        kind: "SINK",
        config: { print_interval_secs: 1 },
        positionX: 520,
        positionY: 200,
      },
    ],
  });

  await prisma.pipelineEdge.create({
    data: {
      pipelineId: QA_IDS.pipeline,
      sourceNodeId: QA_IDS.sourceNode,
      targetNodeId: QA_IDS.sinkNode,
    },
  });

  await prisma.pipelineVersion.create({
    data: {
      pipelineId: QA_IDS.pipeline,
      version: 1,
      configYaml: "# QA dev seed pipeline config",
      nodesSnapshot: [
        {
          id: QA_IDS.sourceNode,
          componentKey: "qa_demo_logs",
          kind: "SOURCE",
          componentType: "demo_logs",
          config: { format: "syslog", interval: 1 },
          positionX: 120,
          positionY: 200,
        },
        {
          id: QA_IDS.sinkNode,
          componentKey: "qa_blackhole",
          kind: "SINK",
          componentType: "blackhole",
          config: { print_interval_secs: 1 },
          positionX: 520,
          positionY: 200,
        },
      ],
      edgesSnapshot: [{ sourceNodeId: QA_IDS.sourceNode, targetNodeId: QA_IDS.sinkNode }],
      createdById: QA_IDS.user,
    },
  });

  await prisma.vectorNode.create({
    data: {
      id: QA_IDS.vectorNode,
      name: "qa-agent-01",
      host: "qa-agent-01.local",
      apiPort: 8686,
      environmentId: QA_IDS.environment,
      status: "HEALTHY",
      lastSeen: new Date(),
      lastHeartbeat: new Date(),
      nodeTokenHash: nodeToken.hash,
      enrolledAt: new Date(),
      agentVersion: "qa-dev",
      vectorVersion: "0.42.0",
      os: "linux",
      deploymentMode: "STANDALONE",
      labels: { env: "qa", seeded: "true" },
    },
  });

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

async function main() {
  const prisma = createPrismaClient();

  try {
    await resetQaSeed(prisma);
    const result = await seedQa(prisma);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
