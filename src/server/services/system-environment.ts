import { prisma } from "@/lib/prisma";

const SYSTEM_TEAM_NAME = "__system__";
const SYSTEM_ENV_NAME = "__system__";

/**
 * Get or create the hidden system team. Every system-scoped entity
 * (system environment, audit log pipeline, etc.) belongs to this team
 * so that the normal withTeamAccess middleware works for super admins.
 */
async function getOrCreateSystemTeam(): Promise<{ id: string }> {
  const existing = await prisma.team.findFirst({
    where: { name: SYSTEM_TEAM_NAME },
  });
  if (existing) return existing;

  return prisma.team.create({
    data: { name: SYSTEM_TEAM_NAME },
  });
}

export async function getOrCreateSystemEnvironment(): Promise<{ id: string }> {
  const existing = await prisma.environment.findFirst({
    where: { isSystem: true },
    select: { id: true, teamId: true },
  });

  const systemTeam = await getOrCreateSystemTeam();

  if (existing) {
    // Backfill: assign system team if env was created before team existed
    if (!existing.teamId) {
      await prisma.environment.update({
        where: { id: existing.id },
        data: { teamId: systemTeam.id },
      });
    }
    return existing;
  }

  return prisma.environment.create({
    data: {
      name: SYSTEM_ENV_NAME,
      isSystem: true,
      teamId: systemTeam.id,
    },
  });
}

export async function getSystemEnvironment(): Promise<{ id: string } | null> {
  const env = await prisma.environment.findFirst({
    where: { isSystem: true },
    select: { id: true, teamId: true },
  });

  // Backfill: assign system team if env was created before team existed
  if (env && !env.teamId) {
    const systemTeam = await getOrCreateSystemTeam();
    await prisma.environment.update({
      where: { id: env.id },
      data: { teamId: systemTeam.id },
    });
  }

  return env;
}
