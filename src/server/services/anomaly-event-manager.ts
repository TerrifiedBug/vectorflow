import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ListAnomaliesInput {
  environmentId: string;
  pipelineId?: string;
  status?: string;
  limit?: number;
  cursor?: string;
  from?: string;
  to?: string;
}

// ─── List ───────────────────────────────────────────────────────────────────

/**
 * List anomaly events with filtering and pagination.
 */
export async function listAnomalies(input: ListAnomaliesInput) {
  const where: Record<string, unknown> = {
    environmentId: input.environmentId,
  };

  if (input.pipelineId) {
    where.pipelineId = input.pipelineId;
  }

  if (input.status) {
    where.status = input.status;
  }

  if (input.from || input.to) {
    where.detectedAt = {
      ...(input.from ? { gte: new Date(input.from) } : {}),
      ...(input.to ? { lte: new Date(input.to) } : {}),
    };
  }

  const take = input.limit ?? 50;

  return prisma.anomalyEvent.findMany({
    where,
    include: {
      pipeline: { select: { id: true, name: true } },
    },
    orderBy: { detectedAt: "desc" },
    take,
    ...(input.cursor
      ? { cursor: { id: input.cursor }, skip: 1 }
      : {}),
  });
}

// ─── Acknowledge ────────────────────────────────────────────────────────────

/**
 * Acknowledge an anomaly event. Marks it as seen by an operator.
 * Cannot acknowledge an already-dismissed anomaly.
 */
export async function acknowledgeAnomaly(anomalyId: string, userId: string) {
  const existing = await prisma.anomalyEvent.findUnique({
    where: { id: anomalyId },
  });

  if (!existing) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Anomaly event not found",
    });
  }

  if (existing.status === "dismissed") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot acknowledge a dismissed anomaly",
    });
  }

  return prisma.anomalyEvent.update({
    where: { id: anomalyId },
    data: {
      status: "acknowledged",
      acknowledgedAt: new Date(),
      acknowledgedBy: userId,
    },
  });
}

// ─── Dismiss ────────────────────────────────────────────────────────────────

/**
 * Dismiss an anomaly event. Removes it from active views.
 */
export async function dismissAnomaly(anomalyId: string, userId: string) {
  const existing = await prisma.anomalyEvent.findUnique({
    where: { id: anomalyId },
  });

  if (!existing) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Anomaly event not found",
    });
  }

  return prisma.anomalyEvent.update({
    where: { id: anomalyId },
    data: {
      status: "dismissed",
      dismissedAt: new Date(),
      dismissedBy: userId,
    },
  });
}

// ─── Count ──────────────────────────────────────────────────────────────────

/**
 * Count open anomaly events per pipeline for a given environment.
 * Used by the pipeline list and fleet dashboard to show anomaly badges.
 *
 * Returns a map of pipelineId -> count of open anomalies.
 */
export async function countOpenAnomalies(
  environmentId: string,
): Promise<Record<string, number>> {
  const groups = await prisma.anomalyEvent.groupBy({
    by: ["pipelineId"],
    where: {
      environmentId,
      status: { in: ["open", "acknowledged"] },
    },
    _count: { id: true },
  });

  const result: Record<string, number> = {};
  for (const group of groups) {
    result[group.pipelineId] = group._count.id;
  }

  return result;
}

/**
 * Get the highest severity open anomaly for each pipeline in an environment.
 * Used for badge coloring (warning vs critical).
 */
export async function getMaxSeverityByPipeline(
  environmentId: string,
): Promise<Record<string, string>> {
  const anomalies = await prisma.anomalyEvent.findMany({
    where: {
      environmentId,
      status: { in: ["open", "acknowledged"] },
    },
    select: {
      pipelineId: true,
      severity: true,
    },
  });

  const severityOrder: Record<string, number> = {
    info: 0,
    warning: 1,
    critical: 2,
  };

  const result: Record<string, string> = {};
  for (const anomaly of anomalies) {
    const current = result[anomaly.pipelineId];
    const currentLevel = current ? (severityOrder[current] ?? 0) : -1;
    const newLevel = severityOrder[anomaly.severity] ?? 0;

    if (newLevel > currentLevel) {
      result[anomaly.pipelineId] = anomaly.severity;
    }
  }

  return result;
}
