import { prisma } from "@/lib/prisma";

const SYSTEM_ENV_NAME = "__system__";

export async function getOrCreateSystemEnvironment(): Promise<{ id: string }> {
  const existing = await prisma.environment.findFirst({
    where: { isSystem: true },
  });
  if (existing) return existing;

  return prisma.environment.create({
    data: {
      name: SYSTEM_ENV_NAME,
      isSystem: true,
      teamId: null,
    },
  });
}

export async function getSystemEnvironment(): Promise<{ id: string } | null> {
  return prisma.environment.findFirst({
    where: { isSystem: true },
  });
}
