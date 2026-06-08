// src/server/routers/proposed-change.ts
//
// Agentic-AI propose → validate(+auto-fix) → human-approve → apply flow (B2).
//
// The AI generates a pipeline-graph or VRL edit. Before anything is staged the
// server VALIDATES it (`vector validate` for a graph, `evaluateVrl` for VRL) and
// runs a BOUNDED auto-fix loop that re-asks the team's own BYO AI model with the
// diagnostics appended. The result is persisted as a PENDING `ProposedChange`
// carrying `validated` + `validationResult`. A human EDITOR must approve before
// it is applied to the pipeline DRAFT — and an unvalidated change can NEVER be
// approved. Autonomy is capped at human-approved apply; nothing auto-deploys
// (the human deploys via the release flow afterwards).
//
// The incident copilot reads the recent AnomalyEvent + Release timeline and
// proposes a rollback when a deploy precedes an anomaly onset; `applyIncidentAction`
// performs the rollback only on explicit human click. Every apply/approve/reject/
// rollback is audited; all procedures are `withTeamAccess`-gated and AI features
// require the team's BYO AI key (`Team.aiEnabled` + `Team.aiApiKey`).

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "crypto";
import { Prisma } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import { withAudit } from "@/server/middleware/audit";
import { nodeSchema, edgeSchema } from "./pipeline-schemas";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig, type ValidationResult } from "@/server/services/validator";
import { evaluateVrl } from "@/server/services/transform-eval";
import { saveGraphComponents } from "@/server/services/pipeline-graph";
import { encryptNodeConfig, decryptNodeConfig } from "@/server/services/config-crypto";
import { completeChat } from "@/server/services/ai";
import { deployFromVersion } from "@/server/services/pipeline-version";
import { stagedRolloutService } from "@/server/services/staged-rollout";
import { correlateIncident } from "@/server/services/incident-copilot";
import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";

type ProposedNode = z.infer<typeof nodeSchema>;
type ProposedEdge = z.infer<typeof edgeSchema>;

/** Bound the agentic auto-fix loop — never burn the team's tokens endlessly. */
const MAX_AUTOFIX_ATTEMPTS = 2;

/** Representative event used to compile-check a VRL program before staging. */
const VRL_SAMPLE_EVENT = {
  message: "sample event",
  timestamp: "2026-01-01T00:00:00Z",
  host: "localhost",
  level: "info",
};

/** Throw unless the team has its BYO AI key configured and AI enabled. */
async function assertTeamAiEnabled(teamId: string): Promise<void> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { aiEnabled: true, aiApiKey: true },
  });
  if (!team?.aiEnabled || !team.aiApiKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "AI is not enabled for this team. Configure a BYO AI key in team settings before proposing AI changes.",
    });
  }
}

/** Convert proposed (DB-shaped) nodes/edges into the ReactFlow shape the YAML generator expects. */
function renderProposedYaml(
  nodes: ProposedNode[],
  edges: ProposedEdge[],
  globalConfig: Record<string, unknown> | null,
): string {
  const flowNodes = nodes.map((n) => ({
    id: n.id ?? n.componentKey,
    type: n.kind.toLowerCase(),
    position: { x: n.positionX, y: n.positionY },
    data: {
      componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
      componentKey: n.componentKey,
      config: n.config,
      disabled: n.disabled,
    },
  }));
  const flowEdges = edges.map((e) => ({
    id: e.id ?? `${e.sourceNodeId}-${e.targetNodeId}`,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
  }));
  return generateVectorYaml(
    flowNodes as unknown as FlowNode[],
    flowEdges as unknown as FlowEdge[],
    globalConfig,
  );
}

/** Strip a leading ```lang / trailing ``` fence the model may wrap its answer in. */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

/** Ask the team's model to repair a VRL program given its diagnostics. Returns null on failure. */
async function autoFixVrl(args: {
  teamId: string;
  source: string;
  error: string;
  prompt?: string | null;
}): Promise<string | null> {
  try {
    const out = await completeChat({
      teamId: args.teamId,
      systemPrompt:
        "You are a Vector VRL expert. Fix the VRL program so it compiles and runs cleanly. " +
        "Return ONLY the corrected VRL source — no explanation, no markdown fences.",
      messages: [
        {
          role: "user",
          content:
            `This VRL failed validation:\n\n${args.error}\n\n` +
            `VRL:\n${args.source}\n\n` +
            (args.prompt ? `Original intent: ${args.prompt}\n\n` : "") +
            "Return the corrected VRL only.",
        },
      ],
    });
    const cleaned = stripCodeFences(out);
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

/** Ask the team's model to repair a pipeline graph given `vector validate` errors. Returns null on failure. */
async function autoFixGraph(args: {
  teamId: string;
  nodes: ProposedNode[];
  edges: ProposedEdge[];
  globalConfig: Record<string, unknown> | null;
  errors: ValidationResult["errors"];
  prompt?: string | null;
}): Promise<{ nodes: ProposedNode[]; edges: ProposedEdge[]; globalConfig: Record<string, unknown> | null } | null> {
  try {
    const out = await completeChat({
      teamId: args.teamId,
      systemPrompt:
        "You are a Vector pipeline expert. Fix the pipeline graph so `vector validate` passes. " +
        "Return ONLY a JSON object with keys `nodes`, `edges`, `globalConfig` matching the input " +
        "shape exactly. No prose, no markdown.",
      messages: [
        {
          role: "user",
          content:
            `vector validate reported:\n${args.errors.map((e) => `- ${e.message}`).join("\n")}\n\n` +
            `Current graph JSON:\n${JSON.stringify({ nodes: args.nodes, edges: args.edges, globalConfig: args.globalConfig })}\n\n` +
            (args.prompt ? `Original intent: ${args.prompt}\n\n` : "") +
            "Return the corrected JSON only.",
        },
      ],
    });
    const body = stripCodeFences(out);
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(body.slice(start, end + 1)) as {
      nodes?: unknown;
      edges?: unknown;
      globalConfig?: unknown;
    };
    const fixedNodes = z.array(nodeSchema).safeParse(parsed.nodes);
    if (!fixedNodes.success) return null;
    const fixedEdges = z.array(edgeSchema).safeParse(parsed.edges ?? []);
    return {
      nodes: fixedNodes.data,
      edges: fixedEdges.success ? fixedEdges.data : [],
      globalConfig:
        parsed.globalConfig && typeof parsed.globalConfig === "object"
          ? (parsed.globalConfig as Record<string, unknown>)
          : args.globalConfig,
    };
  } catch {
    return null;
  }
}

const proposeInput = z.object({
  pipelineId: z.string(),
  kind: z.enum(["PIPELINE_GRAPH", "VRL"]),
  summary: z.string().max(500).optional(),
  prompt: z.string().max(4000).optional(),
  // PIPELINE_GRAPH facet
  proposedNodes: z.array(nodeSchema).optional(),
  proposedEdges: z.array(edgeSchema).optional(),
  proposedGlobalConfig: z.record(z.string(), z.unknown()).nullish(),
  // VRL facet
  targetComponentKey: z.string().optional(),
  vrlSource: z.string().optional(),
});

export const proposedChangeRouter = router({
  /**
   * Stage an AI-proposed change. Validates first (graph: render + `vector
   * validate`; VRL: `evaluateVrl`), runs a bounded auto-fix loop on failure,
   * then persists a PENDING ProposedChange with `validated` + `validationResult`.
   * An invalid proposal is still staged (PENDING, validated=false) so its
   * diagnostics are surfaced — but it can never be approved.
   */
  propose: protectedProcedure
    .input(proposeInput)
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("ai.change_proposed", "ProposedChange"))
    .mutation(async ({ input, ctx }) => {
      const teamId = (ctx as Record<string, unknown>).teamId as string;
      await assertTeamAiEnabled(teamId);

      const pipeline = await prisma.pipeline.findFirst({
        where: { id: input.pipelineId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      const userId = ctx.session.user?.id ?? null;

      if (input.kind === "PIPELINE_GRAPH") {
        if (!input.proposedNodes) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "proposedNodes is required for a PIPELINE_GRAPH change",
          });
        }
        let nodes = input.proposedNodes;
        let edges = input.proposedEdges ?? [];
        let globalConfig = input.proposedGlobalConfig ?? null;

        let validation = await validateConfig(renderProposedYaml(nodes, edges, globalConfig));
        let attempts = 0;
        while (!validation.valid && attempts < MAX_AUTOFIX_ATTEMPTS) {
          attempts++;
          const fixed = await autoFixGraph({
            teamId,
            nodes,
            edges,
            globalConfig,
            errors: validation.errors,
            prompt: input.prompt,
          });
          if (!fixed) break;
          nodes = fixed.nodes;
          edges = fixed.edges;
          globalConfig = fixed.globalConfig;
          validation = await validateConfig(renderProposedYaml(nodes, edges, globalConfig));
        }

        return prisma.proposedChange.create({
          data: {
            organizationId: ctx.organizationId,
            pipelineId: input.pipelineId,
            kind: "PIPELINE_GRAPH",
            status: "PENDING",
            summary: input.summary ?? `AI-proposed pipeline graph change (${nodes.length} nodes)`,
            prompt: input.prompt ?? null,
            proposedNodes: nodes as unknown as Prisma.InputJsonValue,
            proposedEdges: edges as unknown as Prisma.InputJsonValue,
            proposedGlobalConfig: (globalConfig ?? undefined) as Prisma.InputJsonValue,
            validated: validation.valid,
            validationResult: {
              kind: "PIPELINE_GRAPH",
              valid: validation.valid,
              errors: validation.errors,
              warnings: validation.warnings,
              autoFixAttempts: attempts,
            } as unknown as Prisma.InputJsonValue,
            createdById: userId,
          },
        });
      }

      // VRL
      if (!input.vrlSource || !input.targetComponentKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "targetComponentKey and vrlSource are required for a VRL change",
        });
      }
      let source = input.vrlSource;
      let result = await evaluateVrl(source, [VRL_SAMPLE_EVENT], { orgId: ctx.organizationId });
      let attempts = 0;
      while (result.error && attempts < MAX_AUTOFIX_ATTEMPTS) {
        attempts++;
        const fixed = await autoFixVrl({
          teamId,
          source,
          error: result.error,
          prompt: input.prompt,
        });
        if (!fixed) break;
        source = fixed;
        result = await evaluateVrl(source, [VRL_SAMPLE_EVENT], { orgId: ctx.organizationId });
      }
      const valid = !result.error;

      return prisma.proposedChange.create({
        data: {
          organizationId: ctx.organizationId,
          pipelineId: input.pipelineId,
          kind: "VRL",
          status: "PENDING",
          summary: input.summary ?? `AI-proposed VRL change for "${input.targetComponentKey}"`,
          prompt: input.prompt ?? null,
          vrlSource: source,
          targetComponentKey: input.targetComponentKey,
          validated: valid,
          validationResult: {
            kind: "VRL",
            valid,
            error: result.error ?? null,
            outputCount: result.outputCount,
            autoFixAttempts: attempts,
          } as unknown as Prisma.InputJsonValue,
          createdById: userId,
        },
      });
    }),

  /** List proposed changes for a pipeline (newest first), optionally filtered by status. */
  list: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        status: z.enum(["PENDING", "APPROVED", "REJECTED", "APPLIED"]).optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      return prisma.proposedChange.findMany({
        where: {
          pipelineId: input.pipelineId,
          organizationId: ctx.organizationId,
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          createdBy: { select: { id: true, name: true, image: true } },
          reviewedBy: { select: { id: true, name: true, image: true } },
        },
      });
    }),

  /** Fetch a single proposed change. */
  get: protectedProcedure
    .input(z.object({ pipelineId: z.string(), changeId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      const change = await prisma.proposedChange.findFirst({
        where: {
          id: input.changeId,
          pipelineId: input.pipelineId,
          organizationId: ctx.organizationId,
        },
        include: {
          createdBy: { select: { id: true, name: true, image: true } },
          reviewedBy: { select: { id: true, name: true, image: true } },
        },
      });
      if (!change) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proposed change not found" });
      }
      return change;
    }),

  /**
   * Approve a PENDING change and apply it to the pipeline DRAFT atomically.
   * REFUSES to apply an unvalidated change (validated=false) — bad AI output is
   * surfaced, never applied. NEVER deploys; the human deploys via the release
   * flow afterwards.
   */
  approve: protectedProcedure
    .input(z.object({ pipelineId: z.string(), changeId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("ai.change_approved", "ProposedChange"))
    .mutation(async ({ input, ctx }) => {
      const change = await prisma.proposedChange.findFirst({
        where: {
          id: input.changeId,
          pipelineId: input.pipelineId,
          organizationId: ctx.organizationId,
        },
      });
      if (!change) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proposed change not found" });
      }
      if (change.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Change is already ${change.status.toLowerCase()}`,
        });
      }
      if (!change.validated) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This change failed validation and cannot be applied. Review the diagnostics and re-propose.",
        });
      }

      const userId = ctx.session.user?.id ?? null;

      return withOrgTx(ctx.organizationId, async (tx) => {
        if (change.kind === "PIPELINE_GRAPH") {
          // Normalize node ids before persisting. nodeSchema allows nodes without
          // an `id`, and validation matched edges via `id ?? componentKey`, so a
          // proposal can legitimately reference nodes by component key. Assign a
          // concrete id to every node and rewrite edge endpoints to it — otherwise
          // saveGraphComponents generates fresh ids for id-less nodes while edges
          // still point at component keys, and the edge FK inserts fail.
          const proposedNodes = (change.proposedNodes as unknown as ProposedNode[]) ?? [];
          const proposedEdges = (change.proposedEdges as unknown as ProposedEdge[]) ?? [];
          const idByRef = new Map<string, string>();
          const normalizedNodes = proposedNodes.map((n) => {
            const id = n.id ?? randomUUID();
            if (n.id) idByRef.set(n.id, id);
            idByRef.set(n.componentKey, id);
            return { ...n, id };
          });
          const normalizedEdges = proposedEdges.map((e) => ({
            ...e,
            sourceNodeId: idByRef.get(e.sourceNodeId) ?? e.sourceNodeId,
            targetNodeId: idByRef.get(e.targetNodeId) ?? e.targetNodeId,
          }));
          await saveGraphComponents(tx, {
            pipelineId: change.pipelineId,
            nodes: normalizedNodes,
            edges: normalizedEdges,
            globalConfig: (change.proposedGlobalConfig as Record<string, unknown> | null) ?? null,
            userId,
          });
        } else {
          if (!change.targetComponentKey || change.vrlSource == null) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "VRL change is missing its target component or source",
            });
          }
          const node = await tx.pipelineNode.findFirst({
            where: { pipelineId: change.pipelineId, componentKey: change.targetComponentKey },
          });
          if (!node) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Target component "${change.targetComponentKey}" not found in pipeline`,
            });
          }
          const decrypted = decryptNodeConfig(
            node.componentType,
            (node.config as Record<string, unknown>) ?? {},
          );
          const nextConfig = encryptNodeConfig(node.componentType, {
            ...decrypted,
            source: change.vrlSource,
          });
          await tx.pipelineNode.update({
            where: { id: node.id },
            data: { config: nextConfig as Prisma.InputJsonValue },
          });
          await tx.pipeline.update({
            where: { id: change.pipelineId },
            data: { updatedById: userId },
          });
        }

        return tx.proposedChange.update({
          where: { id: change.id },
          data: {
            status: "APPLIED",
            validated: true,
            reviewedById: userId,
            reviewedAt: new Date(),
            appliedAt: new Date(),
          },
        });
      });
    }),

  /** Reject a PENDING change with an optional note. */
  reject: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        changeId: z.string(),
        reviewNote: z.string().max(1000).optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("ai.change_rejected", "ProposedChange"))
    .mutation(async ({ input, ctx }) => {
      const change = await prisma.proposedChange.findFirst({
        where: {
          id: input.changeId,
          pipelineId: input.pipelineId,
          organizationId: ctx.organizationId,
        },
        select: { id: true, status: true },
      });
      if (!change) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proposed change not found" });
      }
      if (change.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Change is already ${change.status.toLowerCase()}`,
        });
      }
      return prisma.proposedChange.update({
        where: { id: change.id },
        data: {
          status: "REJECTED",
          reviewNote: input.reviewNote ?? null,
          reviewedById: ctx.session.user?.id ?? null,
          reviewedAt: new Date(),
        },
      });
    }),

  /**
   * Incident copilot: read the recent open AnomalyEvent + Release timeline for a
   * pipeline/environment and propose a rollback when a deploy precedes an anomaly
   * onset. Read-only — proposes, never applies.
   */
  incidentCopilot: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string().optional(),
        environmentId: z.string().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .query(async ({ input, ctx }) => {
      const teamId = (ctx as Record<string, unknown>).teamId as string;
      await assertTeamAiEnabled(teamId);

      const pipelineScope = input.pipelineId ? { pipelineId: input.pipelineId } : {};
      const environmentScope = input.environmentId ? { environmentId: input.environmentId } : {};

      const [anomalies, releases] = await Promise.all([
        prisma.anomalyEvent.findMany({
          where: {
            organizationId: ctx.organizationId,
            status: "open",
            ...pipelineScope,
            ...environmentScope,
          },
          orderBy: { detectedAt: "desc" },
          take: 25,
          select: {
            id: true,
            pipelineId: true,
            environmentId: true,
            metricName: true,
            severity: true,
            message: true,
            status: true,
            detectedAt: true,
          },
        }),
        prisma.release.findMany({
          where: {
            organizationId: ctx.organizationId,
            ...pipelineScope,
            ...environmentScope,
          },
          orderBy: { createdAt: "desc" },
          take: 25,
          select: {
            id: true,
            strategy: true,
            status: true,
            pipelineId: true,
            environmentId: true,
            changelog: true,
            deployedAt: true,
            createdAt: true,
          },
        }),
      ]);

      return correlateIncident({
        anomalies: anomalies.map((a) => ({ ...a, severity: String(a.severity) })),
        releases,
      });
    }),

  /**
   * Apply an incident-copilot rollback on explicit human click. Delegates to the
   * matching release path: CANARY → the staged-rollout rollback service;
   * DIRECT/PROMOTION → redeploy the PipelineVersion that preceded the release.
   * Audited as `ai.incident_rollback`. Never invoked automatically.
   */
  applyIncidentAction: protectedProcedure
    .input(z.object({ pipelineId: z.string(), releaseId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("ai.incident_rollback", "Release"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const release = await prisma.release.findFirst({
        where: { id: input.releaseId, organizationId: ctx.organizationId },
        select: {
          id: true,
          strategy: true,
          pipelineId: true,
          deployedAt: true,
          createdAt: true,
        },
      });
      if (!release || release.pipelineId !== input.pipelineId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Release not found" });
      }

      if (release.strategy === "CANARY") {
        await stagedRolloutService.rollbackRollout(release.id);
        return { id: release.id, strategy: "CANARY" as const, rolledBack: true };
      }

      // DIRECT / PROMOTION: redeploy the version that preceded this release's deploy.
      const cutoff = release.deployedAt ?? release.createdAt;
      const prior = await prisma.pipelineVersion.findFirst({
        where: { pipelineId: input.pipelineId, createdAt: { lt: cutoff } },
        orderBy: { version: "desc" },
        select: { id: true, version: true },
      });
      if (!prior) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No prior version to roll back to",
        });
      }
      const result = await deployFromVersion(
        input.pipelineId,
        prior.id,
        userId,
        `Incident rollback of release ${release.id}`,
      );
      return {
        id: release.id,
        strategy: release.strategy,
        rolledBack: true,
        version: result.version,
      };
    }),
});
