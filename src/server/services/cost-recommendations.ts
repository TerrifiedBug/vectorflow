import { prisma } from "@/lib/prisma";
import type { AnalysisResult } from "@/server/services/cost-optimizer-types";
import { debugLog } from "@/lib/logger";
import { Prisma } from "@/generated/prisma";
import type { RecommendationStatus, CostRecommendation } from "@/generated/prisma";

const TAG = "cost-recommendations";

const RECOMMENDATION_TTL_DAYS = 7;

/**
 * Persist analysis results as CostRecommendation records.
 * Deduplicates against existing PENDING recommendations for the same pipeline+type.
 */
export async function storeRecommendations(
  results: readonly AnalysisResult[],
): Promise<{ created: number; skipped: number }> {
  // Fetch existing PENDING recommendations to deduplicate
  const existingPending = await prisma.costRecommendation.findMany({
    where: { status: "PENDING" },
    select: { pipelineId: true, type: true },
  });

  const existingSet = new Set(
    existingPending.map((r) => `${r.pipelineId}::${r.type}`),
  );

  const expiresAt = new Date(Date.now() + RECOMMENDATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  let created = 0;
  let skipped = 0;

  for (const result of results) {
    const dedupeKey = `${result.pipelineId}::${result.type}`;
    if (existingSet.has(dedupeKey)) {
      skipped++;
      continue;
    }

    await prisma.costRecommendation.create({
      data: {
        teamId: result.teamId,
        environmentId: result.environmentId,
        pipelineId: result.pipelineId,
        type: result.type,
        title: result.title,
        description: result.description,
        analysisData: result.analysisData as unknown as Prisma.InputJsonValue,
        estimatedSavingsBytes: result.estimatedSavingsBytes,
        suggestedAction: result.suggestedAction != null ? result.suggestedAction as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
        expiresAt,
      },
    });
    created++;
    existingSet.add(dedupeKey);
  }

  debugLog(TAG, `Stored recommendations: ${created} created, ${skipped} skipped (duplicates)`);
  return { created, skipped };
}

/** Remove expired recommendations. */
export async function cleanupExpiredRecommendations(): Promise<number> {
  const result = await prisma.costRecommendation.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  debugLog(TAG, `Cleaned up ${result.count} expired recommendations`);
  return result.count;
}

/** List recommendations for a team+environment, optionally filtered by status. */
export async function listRecommendations(opts: {
  environmentId: string;
  status?: RecommendationStatus;
  limit?: number;
}): Promise<CostRecommendation[]> {
  return prisma.costRecommendation.findMany({
    where: {
      environmentId: opts.environmentId,
      status: opts.status ?? "PENDING",
      expiresAt: { gt: new Date() },
    },
    include: {
      pipeline: { select: { id: true, name: true } },
      dismissedBy: { select: { id: true, name: true } },
    },
    orderBy: [
      { estimatedSavingsBytes: "desc" },
      { createdAt: "desc" },
    ],
    take: opts.limit ?? 50,
  });
}

/** Dismiss a recommendation. */
export async function dismissRecommendation(
  id: string,
  userId: string,
): Promise<CostRecommendation> {
  return prisma.costRecommendation.update({
    where: { id },
    data: {
      status: "DISMISSED",
      dismissedById: userId,
      dismissedAt: new Date(),
    },
  });
}

/** Mark a recommendation as applied. */
export async function markRecommendationApplied(
  id: string,
): Promise<CostRecommendation> {
  return prisma.costRecommendation.update({
    where: { id },
    data: {
      status: "APPLIED",
      appliedAt: new Date(),
    },
  });
}
