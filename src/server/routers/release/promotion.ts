import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import {
  preflightSecrets,
  executePromotion,
  generateDiffPreview,
} from "@/server/services/promotion-service";
import { createPromotionPR } from "@/server/services/gitops-promotion";
import { loadOrgDataKeyCiphertext } from "@/server/services/crypto-v3-callsite";
import { generateVectorYaml } from "@/lib/config-generator";
import { decryptNodeConfig } from "@/server/services/config-crypto";

const PROMOTION_STATUS_KEYS = [
  "PENDING",
  "APPROVED",
  "DEPLOYED",
  "REJECTED",
  "CANCELLED",
  "AWAITING_PR_MERGE",
  "DEPLOYING",
] as const;

type PromotionStatusKey = (typeof PROMOTION_STATUS_KEYS)[number];

const promotionStatusSchema = z.enum(PROMOTION_STATUS_KEYS);

export const promotionReleaseRouter = router({
  /**
   * Preflight check: validates all SECRET[name] references in the source pipeline
   * exist as named secrets in the target environment.
   * Also checks for pipeline name collisions.
   */
  preflight: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        targetEnvironmentId: z.string(),
        name: z.string().optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: { name: true },
      });
      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      const targetPipelineName = input.name ?? pipeline.name;

      // Check for name collision in target env
      const nameCollision = await prisma.pipeline.findFirst({
        where: {
          environmentId: input.targetEnvironmentId,
          name: targetPipelineName,
        },
        select: { id: true },
      });

      const targetEnv = await prisma.environment.findUnique({
        where: { id: input.targetEnvironmentId },
        select: { name: true },
      });

      const secretPreflight = await preflightSecrets(input.pipelineId, input.targetEnvironmentId);

      return {
        ...secretPreflight,
        nameCollision: nameCollision !== null,
        targetEnvironmentName: targetEnv?.name ?? input.targetEnvironmentId,
        targetPipelineName,
      };
    }),

  /**
   * Generates a side-by-side YAML diff preview showing source config
   * (with SECRET refs visible) vs target config (with SECRET refs as env vars).
   */
  diffPreview: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return generateDiffPreview(input.pipelineId);
    }),

  /**
   * Initiates a pipeline promotion from source to target environment.
   * - Creates a PromotionRequest with status PENDING (when approval required)
   * - Or auto-approves and executes when requireDeployApproval is false
   */
  initiate: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        targetEnvironmentId: z.string(),
        name: z.string().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("promotion.initiated", "PromotionRequest"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      // Load source pipeline with environment
      const sourcePipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: {
          nodes: true,
          edges: true,
          environment: {
            select: { teamId: true, id: true, name: true },
          },
        },
      });
      if (!sourcePipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      // Load target environment (including GitOps fields for PR-based promotion)
      const targetEnv = await prisma.environment.findUnique({
        where: { id: input.targetEnvironmentId },
        select: {
          id: true,
          teamId: true,
          organizationId: true,
          name: true,
          requireDeployApproval: true,
          gitOpsMode: true,
          gitRepoUrl: true,
          gitToken: true,
          gitBranch: true,
          gitProvider: true,
        },
      });
      if (!targetEnv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Target environment not found" });
      }

      // Validate: source and target must be different environments
      if (sourcePipeline.environmentId === input.targetEnvironmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Source and target environments must be different",
        });
      }

      // Validate: same team constraint
      if (targetEnv.teamId !== sourcePipeline.environment.teamId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target environment must belong to the same team as the source pipeline",
        });
      }

      const targetPipelineName = input.name ?? sourcePipeline.name;

      // Check for pipeline name collision in target env
      const nameCollision = await prisma.pipeline.findFirst({
        where: {
          environmentId: input.targetEnvironmentId,
          name: targetPipelineName,
        },
        select: { id: true, name: true },
      });
      if (nameCollision) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A pipeline named "${targetPipelineName}" already exists in environment "${targetEnv.name}"`,
        });
      }

      // Preflight: check all secret refs are present in target env
      const preflight = await preflightSecrets(input.pipelineId, input.targetEnvironmentId);
      if (!preflight.canProceed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Missing secrets in target environment: ${preflight.missing.join(", ")}`,
        });
      }

      // Capture snapshots from source pipeline
      const nodesSnapshot = sourcePipeline.nodes.map((n) => ({
        id: n.id,
        componentKey: n.componentKey,
        componentType: n.componentType,
        kind: n.kind,
        config: n.config,
        positionX: n.positionX,
        positionY: n.positionY,
        disabled: n.disabled,
      }));
      const edgesSnapshot = sourcePipeline.edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourcePort: e.sourcePort,
      }));

      // Create the PromotionRequest
      const promotionRequest = await prisma.release.create({
        data: {
          strategy: "PROMOTION",
          pipelineId: input.pipelineId,
          environmentId: sourcePipeline.environmentId,
          targetEnvironmentId: input.targetEnvironmentId,
          status: "PENDING",
          requestedById: userId,
          targetPipelineName,
          nodesSnapshot: nodesSnapshot as unknown as Prisma.InputJsonValue,
          edgesSnapshot: edgesSnapshot as unknown as Prisma.InputJsonValue,
          globalConfigSnapshot: sourcePipeline.globalConfig as Prisma.InputJsonValue | null ?? undefined,
        },
      });

      // GitOps path: if target env has gitOpsMode="promotion" and a configured repo,
      // create a GitHub PR instead of directly executing. The PR merge will trigger deployment.
      if (targetEnv.gitOpsMode === "promotion" && targetEnv.gitRepoUrl && targetEnv.gitToken) {
        // Build YAML from source pipeline nodes (preserve SECRET[name] refs as-is)
        const flowEdges = sourcePipeline.edges.map((e) => ({
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
        }));
        const flowNodes = sourcePipeline.nodes.map((n) => ({
          id: n.id,
          type: n.kind.toLowerCase(),
          position: { x: n.positionX, y: n.positionY },
          data: {
            componentDef: { type: n.componentType, kind: n.kind.toLowerCase() },
            componentKey: n.componentKey,
            config: decryptNodeConfig(n.componentType, (n.config as Record<string, unknown>) ?? {}),
            disabled: n.disabled,
          },
        }));
        const configYaml = generateVectorYaml(
          flowNodes as Parameters<typeof generateVectorYaml>[0],
          flowEdges as Parameters<typeof generateVectorYaml>[1],
          sourcePipeline.globalConfig as Record<string, unknown> | null,
          null,
        );

        const dataKeyCiphertext = await loadOrgDataKeyCiphertext(targetEnv.organizationId);
        const pr = await createPromotionPR({
          encryptedToken: targetEnv.gitToken,
          repoUrl: targetEnv.gitRepoUrl,
          baseBranch: targetEnv.gitBranch ?? "main",
          requestId: promotionRequest.id,
          pipelineName: sourcePipeline.name,
          sourceEnvironmentName: sourcePipeline.environment.name,
          targetEnvironmentName: targetEnv.name,
          configYaml,
          gitProvider: targetEnv.gitProvider ?? null,
          gitPath: sourcePipeline.gitPath ?? null,
          orgId: targetEnv.organizationId,
          environmentId: targetEnv.id,
          dataKeyCiphertext,
        });

        await prisma.release.update({
          where: { id: promotionRequest.id, strategy: "PROMOTION" },
          data: {
            prUrl: pr.prUrl,
            prNumber: pr.prNumber,
            status: "AWAITING_PR_MERGE",
          },
        });

        return {
          requestId: promotionRequest.id,
          status: "AWAITING_PR_MERGE",
          prUrl: pr.prUrl,
          pendingApproval: false,
        };
      }

      // UI path: if no approval required, auto-execute
      if (!targetEnv.requireDeployApproval) {
        await executePromotion(promotionRequest.id, userId);
        return { requestId: promotionRequest.id, status: "DEPLOYED", pendingApproval: false };
      }

      return { requestId: promotionRequest.id, status: "PENDING", pendingApproval: true };
    }),

  /**
   * Approves a pending promotion request and executes the promotion.
   * Self-review is blocked. Uses atomic updateMany to prevent race conditions.
   */
  approve: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("promotion.approved", "PromotionRequest"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const request = await prisma.release.findFirst({
        where: { id: input.requestId, strategy: "PROMOTION" },
        select: { id: true, status: true, requestedById: true },
      });
      if (!request || request.status !== "PENDING") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Promotion request not found or not pending",
        });
      }

      // Self-review guard
      if (request.requestedById === userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot approve your own promotion request",
        });
      }

      // Atomic claim — prevents double-approval race condition
      const updated = await prisma.release.updateMany({
        where: { id: input.requestId, status: "PENDING", strategy: "PROMOTION" },
        data: {
          status: "APPROVED",
          reviewedById: userId,
          reviewedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Promotion request is no longer pending",
        });
      }

      // Execute the promotion
      const result = await executePromotion(input.requestId, userId);

      return { success: true, pipelineId: result.pipelineId, pipelineName: result.pipelineName };
    }),

  /**
   * Rejects a pending promotion request.
   */
  reject: protectedProcedure
    .input(z.object({ requestId: z.string(), note: z.string().optional() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("promotion.rejected", "PromotionRequest"))
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .mutation(async ({ input, ctx }) => {
      const request = await prisma.release.findFirst({
        where: { id: input.requestId, strategy: "PROMOTION" },
        select: { id: true, status: true, targetPipelineId: true },
      });
      if (!request || request.status !== "PENDING") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Promotion request not found or not pending",
        });
      }

      // Atomically reject — prevents race with concurrent approve
      const updated = await prisma.release.updateMany({
        where: { id: input.requestId, status: "PENDING", strategy: "PROMOTION" },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewNote: input.note ?? null,
        },
      });
      if (updated.count === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Promotion request is no longer pending",
        });
      }

      // Safety: clean up target pipeline if one was somehow created (shouldn't happen for PENDING)
      if (request.targetPipelineId) {
        await prisma.pipeline.delete({ where: { id: request.targetPipelineId } }).catch(() => {
          // Ignore deletion errors
        });
      }

      return { rejected: true };
    }),

  /**
   * Cancels a pending promotion request. Only the original promoter can cancel.
   */
  cancel: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("promotion.cancelled", "PromotionRequest"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const request = await prisma.release.findFirst({
        where: { id: input.requestId, strategy: "PROMOTION" },
        select: { id: true, status: true, requestedById: true },
      });
      if (!request || request.status !== "PENDING") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Promotion request not found or not pending",
        });
      }

      // Only the original promoter can cancel
      if (request.requestedById !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the original promoter can cancel a pending request",
        });
      }

      const updated = await prisma.release.updateMany({
        where: { id: input.requestId, status: "PENDING", strategy: "PROMOTION" },
        data: { status: "CANCELLED" },
      });
      if (updated.count === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Promotion request status changed — try again",
        });
      }

      return { cancelled: true };
    }),

  summaryForTeam: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const grouped = await prisma.release.groupBy({
        by: ["status"],
        where: { strategy: "PROMOTION", pipeline: { environment: { teamId: input.teamId } } },
        _count: { _all: true },
      });

      const summary = Object.fromEntries(
        PROMOTION_STATUS_KEYS.map((status) => [status, 0]),
      ) as Record<PromotionStatusKey, number>;

      for (const row of grouped) {
        summary[row.status as PromotionStatusKey] = row._count._all;
      }

      return summary;
    }),

  /**
   * Returns recent promotion requests across an entire team, ordered by
   * createdAt desc. Powers the team-scoped Promotions hub view.
   *
   * Team scope is enforced via `pipeline.environment.teamId` — every
   * promotion is anchored to a source pipeline whose environment belongs to
   * exactly one team.
   *
   * Cursor pagination uses the `id` of the last item in the page.
   */
  recentForTeam: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        status: promotionStatusSchema.optional(),
        statuses: z.array(promotionStatusSchema).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const statusWhere = input.status
        ? { status: input.status }
        : input.statuses?.length
          ? { status: { in: input.statuses } }
          : {};

      const records = await prisma.release.findMany({
        where: {
          strategy: "PROMOTION",
          pipeline: { environment: { teamId: input.teamId } },
          ...statusWhere,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          pipeline: { select: { id: true, name: true } },
          targetPipeline: { select: { id: true, name: true } },
          requestedBy: { select: { name: true, email: true } },
          reviewedBy: { select: { name: true, email: true } },
          environment: { select: { name: true } },
          targetEnvironment: { select: { name: true } },
        },
      });

      const hasMore = records.length > input.limit;
      const items = hasMore ? records.slice(0, input.limit) : records;
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? last.id : null;
      return { items, nextCursor };
    }),

  /**
   * Returns promotion history for a pipeline ordered by createdAt desc.
   * Includes related user names, emails, and environment names.
   */
  history: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const records = await prisma.release.findMany({
        where: { strategy: "PROMOTION", pipelineId: input.pipelineId },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          requestedBy: { select: { name: true, email: true } },
          reviewedBy: { select: { name: true, email: true } },
          environment: { select: { name: true } },
          targetEnvironment: { select: { name: true } },
        },
      });

      return records;
    }),
});
