import { prisma } from "@/lib/prisma";

/**
 * Resolve the teamId for a given environment.
 * Used by REST API v1 routes to verify resource ownership.
 */
export async function resolveTeamForEnv(environmentId: string): Promise<string | null> {
  const env = await prisma.environment.findUnique({
    where: { id: environmentId },
    select: { teamId: true },
  });
  return env?.teamId ?? null;
}
