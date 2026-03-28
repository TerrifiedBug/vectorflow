import { prisma } from "@/lib/prisma";
import { apiRoute, jsonResponse } from "../_lib/api-handler";

export const GET = apiRoute(
  "environments.read",
  async (_req, ctx) => {
    // Resolve the team from the service account's environment
    const env = await prisma.environment.findUnique({
      where: { id: ctx.environmentId },
      select: { teamId: true },
    });

    if (!env?.teamId) {
      return jsonResponse({ environments: [] });
    }

    // Return all environments in the same team
    const environments = await prisma.environment.findMany({
      where: { teamId: env.teamId },
      select: {
        id: true,
        name: true,
        isSystem: true,
        requireDeployApproval: true,
        gitOpsMode: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    });

    return jsonResponse({ environments });
  },
  "read",
);
