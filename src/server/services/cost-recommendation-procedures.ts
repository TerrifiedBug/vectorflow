import yaml from "js-yaml";
import { TRPCError } from "@trpc/server";
import { diffLines } from "diff";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { withOrgTxFromContext } from "@/lib/with-org-tx";
import { createVersion } from "@/server/services/pipeline-version";
import {
  applyRecommendationToYaml,
  dropFieldsVrl,
} from "@/server/services/cost-optimizer-apply";
import { fetchRecentPipelineEvents } from "@/server/services/cost-optimizer";
import {
  loadDestinationCostModels,
  getPrimarySinkTypes,
  projectSinkCostCents,
} from "@/server/services/cost-attribution";
import { evaluateVrl } from "@/server/services/transform-eval";
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

  // Update the pipeline graph (nodes + edges) so the deploy flow
  // generates YAML consistent with the applied recommendation.
  // Without this, deployAgent regenerates YAML from stale graph state,
  // effectively reverting the recommendation.
  const graphNode = suggestedActionToGraphNode(suggestedAction);
  if (graphNode) {
    await withOrgTxFromContext(async (tx) => {
      const sinkNode = await tx.pipelineNode.findFirst({
        where: { pipelineId, componentKey: targetSinkKey },
      });

      if (sinkNode) {
        // Find all edges currently pointing to the sink
        const incomingEdges = await tx.pipelineEdge.findMany({
          where: { pipelineId, targetNodeId: sinkNode.id },
        });

        const transformConfig = graphNode.config;

        const transformNode = await tx.pipelineNode.create({
          data: {
            pipelineId,
            componentKey: graphNode.componentKey,
            componentType: graphNode.componentType,
            kind: "TRANSFORM",
            config: transformConfig as unknown as Prisma.InputJsonValue,
            positionX: sinkNode.positionX,
            positionY: sinkNode.positionY - 120,
          },
        });

        // Rewire: incoming edges now point to the transform
        for (const edge of incomingEdges) {
          await tx.pipelineEdge.update({
            where: { id: edge.id },
            data: { targetNodeId: transformNode.id },
          });
        }

        // Add edge from transform to sink
        await tx.pipelineEdge.create({
          data: {
            pipelineId,
            sourceNodeId: transformNode.id,
            targetNodeId: sinkNode.id,
          },
        });
      }
    });
  }

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

/**
 * Map a suggested action to the transform graph node that applies it (component
 * type + config + key). Returns null for actions that don't insert a transform
 * (disable_pipeline).
 */
function suggestedActionToGraphNode(
  action: SuggestedAction,
): { componentKey: string; componentType: string; config: Record<string, unknown> } | null {
  switch (action.type) {
    case "add_filter":
      return {
        componentKey: action.config.componentKey,
        componentType: "filter",
        config: { condition: action.config.condition },
      };
    case "add_sampling":
      return {
        componentKey: action.config.componentKey,
        componentType: "sample",
        config: { rate: action.config.rate },
      };
    case "drop_field":
      return {
        componentKey: action.config.componentKey,
        componentType: "remap",
        config: { source: dropFieldsVrl(action.config.fields) },
      };
    case "tail_sample":
      return {
        componentKey: action.config.componentKey,
        componentType: "tail_sample",
        config: {
          key: action.config.key,
          windowMs: action.config.windowMs,
          keepPolicies: action.config.keepPolicies,
        },
      };
    case "disable_pipeline":
      return null;
  }
}

/**
 * Deterministic per-event sampler VRL approximating Vector's `sample` transform.
 * `rate <= 1` is treated as a keep-fraction; `rate > 1` as keep-1-in-N. Hashes
 * the event so the same event is always kept or dropped (stable before/after).
 */
function samplingVrl(rate: number): string {
  const keepFraction = rate <= 0 ? 0 : rate <= 1 ? rate : 1 / rate;
  const keepPct = Math.max(0, Math.min(100, Math.round(keepFraction * 100)));
  if (keepPct >= 100) return ""; // keep everything → no-op pass-through
  if (keepPct <= 0) return "abort"; // drop everything
  return `if mod(abs(seahash(encode_json(.))), 100) >= ${keepPct} {\n  abort\n}`;
}

/**
 * Derive a VRL program that simulates a suggested action's reduction effect on a
 * stream of events (run via `evaluateVrl`). Returns null for actions with
 * nothing to simulate (disable_pipeline).
 */
export function suggestedActionToVrl(action: SuggestedAction): string | null {
  switch (action.type) {
    case "drop_field":
      return dropFieldsVrl(action.config.fields);
    case "add_filter":
      // Vector `filter` keeps events where the condition is true; simulate the
      // drop of the complement via `abort`.
      return `if !(${action.config.condition}) {\n  abort\n}`;
    case "add_sampling":
      return samplingVrl(action.config.rate);
    case "tail_sample":
      // Tail sampling is windowed/whole-trace and cannot be simulated per-event
      // via VRL — the TRACE_TAIL_SAMPLE detector projects its reduction with the
      // dedicated trace-sampling simulator instead.
      return null;
    case "disable_pipeline":
      return null;
  }
}

export interface SimulateTransformInput {
  environmentId: string;
  organizationId: string;
  /** Simulate a stored recommendation's suggested transform. */
  recommendationId?: string;
  /** Or simulate caller-supplied VRL against a specific pipeline's events. */
  pipelineId?: string;
  /** Caller-supplied VRL; overrides the recommendation's derived transform. */
  vrl?: string;
}

export interface SimulateTransformResult {
  /** true when there were no sample events to simulate against (skipped cleanly). */
  skipped: boolean;
  reason?: string;
  pipelineId: string;
  /** The VRL that was (or would be) evaluated. */
  source: string;
  inputCount: number;
  outputCount: number;
  droppedCount: number;
  eventReductionPercent: number;
  byteReductionPercent: number;
  /** Projected $ saving (cents) at the sink, null when no DestinationCostModel / no baseline. */
  estimatedSavingsCents: number | null;
  /** Present when VRL evaluation failed (compile error, missing vector binary). */
  error?: string;
}

/**
 * Project a dollar saving (cents) from a simulated byte-reduction percentage:
 * apply the percentage to the pipeline's recent destination volume (24h
 * bytesOut) and price it via the sink's DestinationCostModel. Null when no
 * model, no sink, or no baseline volume.
 */
async function projectSimulatedSavings(
  pipelineId: string,
  organizationId: string,
  byteReductionPercent: number,
): Promise<number | null> {
  if (byteReductionPercent <= 0) return null;

  // Short-circuit before resolving the sink type / baseline volume when the org
  // has no price models at all — keeps the simulator byte-only (no $).
  const costModels = await loadDestinationCostModels(organizationId);
  if (costModels.length === 0) return null;

  const sinkTypes = await getPrimarySinkTypes([pipelineId]);
  const sinkType = sinkTypes.get(pipelineId);
  if (!sinkType) return null;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const agg = await prisma.pipelineMetric.aggregate({
    where: { pipelineId, componentId: null, nodeId: null, timestamp: { gte: since } },
    _sum: { bytesOut: true },
  });
  const baselineBytesOut = Number(agg._sum.bytesOut ?? 0);
  if (baselineBytesOut <= 0) return null;

  const estimatedBytesSaved = (byteReductionPercent / 100) * baselineBytesOut;
  return projectSinkCostCents(estimatedBytesSaved, sinkType, costModels);
}

/**
 * What-if simulator: run a proposed transform (a recommendation's suggested
 * action, or caller-supplied VRL) against the pipeline's most recent
 * TapCapture/EventSample via `evaluateVrl` and return the projected reduction
 * BEFORE apply, plus a $ projection when a DestinationCostModel exists. Skips
 * cleanly (no fabricated numbers) when there is no event sample.
 */
export async function simulateTransform(
  input: SimulateTransformInput,
): Promise<SimulateTransformResult> {
  let pipelineId: string;
  let source: string | null;

  if (input.recommendationId) {
    const rec = await prisma.costRecommendation.findUnique({
      where: { id: input.recommendationId },
      select: { environmentId: true, pipelineId: true, suggestedAction: true },
    });
    if (!rec || rec.environmentId !== input.environmentId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
    }
    pipelineId = rec.pipelineId;
    if (input.vrl != null && input.vrl.trim() !== "") {
      source = input.vrl;
    } else {
      const action = rec.suggestedAction as unknown as SuggestedAction | null;
      source = action ? suggestedActionToVrl(action) : null;
    }
  } else {
    if (!input.pipelineId || input.vrl == null || input.vrl.trim() === "") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Provide a recommendationId, or a pipelineId together with vrl, to simulate",
      });
    }
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: input.pipelineId },
      select: { environmentId: true },
    });
    if (!pipeline || pipeline.environmentId !== input.environmentId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
    }
    pipelineId = input.pipelineId;
    source = input.vrl;
  }

  if (source == null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This recommendation has no simulatable transform",
    });
  }

  const events = await fetchRecentPipelineEvents(pipelineId);
  if (events.length === 0) {
    return {
      skipped: true,
      reason: "No recent tap capture or event sample to simulate against",
      pipelineId,
      source,
      inputCount: 0,
      outputCount: 0,
      droppedCount: 0,
      eventReductionPercent: 0,
      byteReductionPercent: 0,
      estimatedSavingsCents: null,
    };
  }

  const result = await evaluateVrl(source, events);
  const estimatedSavingsCents = await projectSimulatedSavings(
    pipelineId,
    input.organizationId,
    result.byteReductionPercent,
  );

  return {
    skipped: false,
    pipelineId,
    source,
    inputCount: result.inputCount,
    outputCount: result.outputCount,
    droppedCount: result.droppedCount,
    eventReductionPercent: result.eventReductionPercent,
    byteReductionPercent: result.byteReductionPercent,
    estimatedSavingsCents,
    error: result.error,
  };
}
