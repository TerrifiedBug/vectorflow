import { PrismaClient } from "../../src/generated/prisma";
import { TEST_USER, TEST_TEAM } from "./constants";

export async function cleanup(prisma: PrismaClient): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: TEST_USER.email },
  });
  if (!user) return;

  const team = await prisma.team.findFirst({
    where: { name: TEST_TEAM.name },
  });

  if (team) {
    const alertRules = await prisma.alertRule.findMany({
      where: { teamId: team.id },
      select: { id: true },
    });
    const alertRuleIds = alertRules.map((r) => r.id);

    if (alertRuleIds.length > 0) {
      await prisma.deliveryAttempt.deleteMany({
        where: { alertEvent: { alertRuleId: { in: alertRuleIds } } },
      });
      await prisma.alertEvent.deleteMany({
        where: { alertRuleId: { in: alertRuleIds } },
      });
      await prisma.alertRule.deleteMany({
        where: { id: { in: alertRuleIds } },
      });
    }

    const environments = await prisma.environment.findMany({
      where: { teamId: team.id },
      select: { id: true },
    });
    const envIds = environments.map((e) => e.id);

    if (envIds.length > 0) {
      await prisma.notificationChannel.deleteMany({
        where: { environmentId: { in: envIds } },
      });

      const pipelines = await prisma.pipeline.findMany({
        where: { environmentId: { in: envIds } },
        select: { id: true },
      });
      const pipelineIds = pipelines.map((p) => p.id);

      if (pipelineIds.length > 0) {
        await prisma.pipelineEdge.deleteMany({
          where: { pipelineId: { in: pipelineIds } },
        });
        await prisma.pipelineNode.deleteMany({
          where: { pipelineId: { in: pipelineIds } },
        });
        await prisma.pipelineVersion.deleteMany({
          where: { pipelineId: { in: pipelineIds } },
        });
        await prisma.pipeline.deleteMany({
          where: { id: { in: pipelineIds } },
        });
      }

      await prisma.vectorNode.deleteMany({
        where: { environmentId: { in: envIds } },
      });

      await prisma.team.update({
        where: { id: team.id },
        data: { defaultEnvironmentId: null },
      });

      await prisma.environment.deleteMany({
        where: { id: { in: envIds } },
      });
    }

    await prisma.teamMember.deleteMany({
      where: { teamId: team.id },
    });
    await prisma.team.delete({
      where: { id: team.id },
    });
  }

  await prisma.user.delete({
    where: { id: user.id },
  });
}
