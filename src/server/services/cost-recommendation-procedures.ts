import yaml from "js-yaml";
import { TRPCError } from "@trpc/server";
import { diffLines } from "diff";
import { prisma } from "@/lib/prisma";
import { createVersion } from "@/server/services/pipeline-version";
import { applyRecommendationToYaml } from "@/server/services/cost-optimizer-apply";
import type { SuggestedAction } from "@/server/services/cost-optimizer-types";

function generateUnifiedDiff(oldText: string, newText: string): string {
  const changes = diffLines(oldText, newText);
  const lines: string[] = [];
  for (const part of changes) {
    const prefix = part.added ? "+" : part.removed ? "-" : " ";
    const partLines = part.value.replace(/\n$/, "").split("\n");
    for (const line of partLines) {
      lines.push(`${prefix} ${line}`);
    }
  }
  return lines.join("\n");
}

function findFirstSinkKey(yamlStr: string): string {
  if (!yamlStr) return "";
  const parsed = yaml.load(yamlStr) as Record<string, Record<string, unknown>> | null;
  const sinks = parsed?.sinks ?? {};
  return Object.keys(sinks)[0] ?? "";
}

/**
 * Preview the effect of applying a cost recommendation.
 * Returns the current YAML, proposed YAML, and a unified diff,
 * or an isDisable flag for disable_pipeline actions.
 */
export async function previewRecommendation(recommendationId: string, environmentId: string) {
  const rec = await prisma.costRecommendation.findUnique({
    where: { id: recommendationId },
    include: {
      pipeline: { select: { id: true, name: true, environmentId: true } },
    },
  });

  if (!rec || rec.environmentId !== environmentId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Recommendation not found",
    });
  }

  const suggestedAction = rec.suggestedAction as unknown as SuggestedAction | null;
  if (!suggestedAction) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No suggested action for this recommendation",
    });
  }

  const recommendation = {
    id: rec.id,
    title: rec.title,
    description: rec.description,
    type: rec.type,
    pipelineId: rec.pipelineId,
    pipelineName: rec.pipeline.name,
    estimatedSavingsBytes: rec.estimatedSavingsBytes,
    suggestedAction,
  };

  if (suggestedAction.type === "disable_pipeline") {
    return { isDisable: true as const, recommendation };
  }

  const latestVersion = await prisma.pipelineVersion.findFirst({
    where: { pipelineId: rec.pipelineId },
    orderBy: { version: "desc" },
    select: { configYaml: true },
  });

  const currentYaml = latestVersion?.configYaml ?? "";
  const analysisData = rec.analysisData as Record<string, unknown> | null;
  const targetSinkKey =
    (analysisData?.targetSinkKey as string | undefined) ??
    (analysisData?.sinkKey as string | undefined) ??
    findFirstSinkKey(currentYaml);

  const proposedYaml =
    applyRecommendationToYaml(currentYaml, suggestedAction, targetSinkKey) ??
    currentYaml;

  const diff = generateUnifiedDiff(currentYaml, proposedYaml);

  return { currentYaml, proposedYaml, diff, recommendation };
}

/**
 * Apply a cost recommendation by creating a new pipeline version
 * (or disabling the pipeline for disable_pipeline actions).
 */
export async function applyRecommendation(
  recommendationId: string,
  userId: string,
  environmentId: string,
) {
  const rec = await prisma.costRecommendation.findUnique({
    where: { id: recommendationId },
    include: {
      pipeline: { select: { id: true, name: true, environmentId: true } },
    },
  });

  if (!rec || rec.environmentId !== environmentId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Recommendation not found",
    });
  }

  if (rec.status !== "PENDING") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Recommendation can only be applied when PENDING (current: ${rec.status})`,
    });
  }

  const suggestedAction = rec.suggestedAction as unknown as SuggestedAction | null;
  if (!suggestedAction) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No suggested action for this recommendation",
    });
  }

  const pipelineId = rec.pipelineId;
  const pipelineName = rec.pipeline.name;

  if (suggestedAction.type === "disable_pipeline") {
    await prisma.pipeline.update({
      where: { id: pipelineId },
      data: { isDraft: true },
    });

    await prisma.costRecommendation.update({
      where: { id: recommendationId },
      data: { status: "APPLIED", appliedAt: new Date() },
    });

    return { success: true as const, pipelineId, pipelineName, versionNumber: 0 };
  }

  const latestVersion = await prisma.pipelineVersion.findFirst({
    where: { pipelineId },
    orderBy: { version: "desc" },
    select: { configYaml: true },
  });

  const currentYaml = latestVersion?.configYaml ?? "";
  const analysisData = rec.analysisData as Record<string, unknown> | null;
  const targetSinkKey =
    (analysisData?.targetSinkKey as string | undefined) ??
    (analysisData?.sinkKey as string | undefined) ??
    findFirstSinkKey(currentYaml);

  const proposedYaml =
    applyRecommendationToYaml(currentYaml, suggestedAction, targetSinkKey) ??
    currentYaml;

  const version = await createVersion(
    pipelineId,
    proposedYaml,
    userId,
    `Applied cost recommendation: ${rec.title}`,
  );

  await prisma.costRecommendation.update({
    where: { id: recommendationId },
    data: { status: "APPLIED", appliedAt: new Date() },
  });

  return {
    success: true as const,
    pipelineId,
    pipelineName,
    versionNumber: version.version,
  };
}
