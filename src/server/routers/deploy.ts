import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { deployAgent, undeployAgent } from "@/server/services/deploy-agent";
import { deployFromVersion } from "@/server/services/pipeline-version";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { withAudit } from "@/server/middleware/audit";
import { writeAuditLog } from "@/server/services/audit";
import { fireEventAlert } from "@/server/services/event-alerts";
import { relayPush } from "@/server/services/push-broadcast";
import { broadcastSSE } from "@/server/services/sse-broadcast";

export const deployRouter = router({
  preview: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: { nodes: true, edges: true, environment: { select: { name: true } } },
      });

      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      const flowNodes = pipeline.nodes.map((n) => ({
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

      const flowEdges = pipeline.edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
      }));

      const latestVersion = await prisma.pipelineVersion.findFirst({
        where: { pipelineId: input.pipelineId },
        orderBy: { version: "desc" },
        select: { configYaml: true, version: true, logLevel: true },
      });

      const enrichment = pipeline.enrichMetadata
        ? {
            environmentName: pipeline.environment.name,
            pipelineVersion: (latestVersion?.version ?? 0) + 1,
          }
        : null;

      const configYaml = generateVectorYaml(
        flowNodes as Parameters<typeof generateVectorYaml>[0],
        flowEdges as Parameters<typeof generateVectorYaml>[1],
        pipeline.globalConfig as Record<string, unknown> | null,
        enrichment,
      );
      const validation = await validateConfig(configYaml);

      return {
        configYaml,
        validation,
        currentConfigYaml: latestVersion?.configYaml ?? null,
        currentVersion: latestVersion?.version ?? null,
        currentLogLevel: latestVersion?.logLevel ?? "info",
        newLogLevel: ((pipeline.globalConfig as Record<string, unknown>)?.log_level as string) ?? "info",
        nodeSelector: pipeline.nodeSelector as Record<string, string> | null,
      };
    }),

  agent: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        changelog: z.string().min(1),
        nodeSelector: z.record(z.string(), z.string()).optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      // Check if approval is required for this environment
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: {
          environment: { select: { id: true, name: true, requireDeployApproval: true } },
          nodes: true,
          edges: true,
        },
      });

      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      const userRole = (ctx as Record<string, unknown>).userRole as string;

      // When approval is required AND user is EDITOR (not ADMIN/SUPER_ADMIN),
      // create a deploy request instead of deploying directly
      if (pipeline.environment.requireDeployApproval && userRole === "EDITOR") {
        // Generate the config YAML to store with the request
        const flowNodes = pipeline.nodes.map((n) => ({
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

        const flowEdges = pipeline.edges.map((e) => ({
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
        }));

        let enrichment: { environmentName: string; pipelineVersion: number } | null = null;
        if (pipeline.enrichMetadata) {
          const latestVer = await prisma.pipelineVersion.findFirst({
            where: { pipelineId: input.pipelineId },
            orderBy: { version: "desc" },
            select: { version: true },
          });
          enrichment = {
            environmentName: pipeline.environment.name,
            pipelineVersion: (latestVer?.version ?? 0) + 1,
          };
        }

        const configYaml = generateVectorYaml(
          flowNodes as Parameters<typeof generateVectorYaml>[0],
          flowEdges as Parameters<typeof generateVectorYaml>[1],
          pipeline.globalConfig as Record<string, unknown> | null,
          enrichment,
        );

        const validation = await validateConfig(configYaml);
        if (!validation.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid pipeline configuration: " + (validation.errors?.map((e: { message: string }) => e.message).join(", ") ?? "unknown error"),
          });
        }

        // Atomic check-and-create to prevent duplicate pending requests
        const request = await prisma.$transaction(async (tx) => {
          const existingPending = await tx.deployRequest.findFirst({
            where: { pipelineId: input.pipelineId, status: "PENDING" },
          });
          if (existingPending) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A pending deploy request already exists for this pipeline",
            });
          }

          return tx.deployRequest.create({
            data: {
              pipelineId: input.pipelineId,
              environmentId: pipeline.environment.id,
              requestedById: userId,
              configYaml,
              changelog: input.changelog,
              nodeSelector: input.nodeSelector ?? undefined,
            },
          });
        }, { isolationLevel: "Serializable" });

        writeAuditLog({
          userId,
          action: "deploy.request_submitted",
          entityType: "DeployRequest",
          entityId: request.id,
          metadata: {
            timestamp: new Date().toISOString(),
            input: { pipelineId: input.pipelineId, changelog: input.changelog },
          },
          teamId: (ctx as Record<string, unknown>).teamId as string | null ?? null,
          environmentId: pipeline.environment.id,
          ipAddress: (ctx as Record<string, unknown>).ipAddress as string | null ?? null,
          userEmail: ctx.session?.user?.email ?? null,
          userName: ctx.session?.user?.name ?? null,
        }).catch(() => {});

        void fireEventAlert("deploy_requested", pipeline.environment.id, {
          message: `Deploy request created for pipeline "${pipeline.name}"`,
          pipelineId: input.pipelineId,
        });

        return {
          success: true,
          pendingApproval: true,
          requestId: request.id,
        };
      }

      const result = await deployAgent(input.pipelineId, userId, input.changelog);

      // Only persist nodeSelector if the deploy actually succeeded
      if (result.success && input.nodeSelector !== undefined) {
        await prisma.pipeline.update({
          where: { id: input.pipelineId },
          data: {
            nodeSelector:
              Object.keys(input.nodeSelector).length > 0
                ? input.nodeSelector
                : Prisma.DbNull,
          },
        });
      }

      writeAuditLog({
        userId,
        action: result.success ? "deploy.agent" : "deploy.agent_failed",
        entityType: "Pipeline",
        entityId: input.pipelineId,
        metadata: {
          timestamp: new Date().toISOString(),
          input: { pipelineId: input.pipelineId, changelog: input.changelog },
          ...(result.pushedNodeIds && result.pushedNodeIds.length > 0
            ? { pushedNodeIds: result.pushedNodeIds }
            : {}),
        },
        teamId: (ctx as Record<string, unknown>).teamId as string | null ?? null,
        environmentId: pipeline.environment.id,
        ipAddress: (ctx as Record<string, unknown>).ipAddress as string | null ?? null,
        userEmail: ctx.session?.user?.email ?? null,
        userName: ctx.session?.user?.name ?? null,
      }).catch(() => {});

      if (result.success) {
        void fireEventAlert("deploy_completed", pipeline.environment.id, {
          message: `Pipeline "${pipeline.name}" deployed`,
          pipelineId: input.pipelineId,
        });

        broadcastSSE({
          type: "status_change",
          nodeId: "",
          fromStatus: "",
          toStatus: "DEPLOYED",
          reason: "deploy completed via UI",
          pipelineId: input.pipelineId,
          pipelineName: pipeline.name,
        }, pipeline.environment.id);
      }

      return result;
    }),

  undeploy: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("deploy.undeploy", "Pipeline"))
    .mutation(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
      });

      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      const result = await undeployAgent(input.pipelineId);

      // Notify connected agents that config has changed
      if (result.success) {
        const nodes = await prisma.vectorNode.findMany({
          where: { environmentId: pipeline.environmentId },
          select: { id: true },
        });
        for (const node of nodes) {
          relayPush(node.id, {
            type: "config_changed",
            pipelineId: input.pipelineId,
            reason: "undeploy",
          });
        }
      }

      return result;
    }),

  deployFromVersion: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        sourceVersionId: z.string(),
        changelog: z.string().optional(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: {
          environment: { select: { id: true, name: true, requireDeployApproval: true } },
        },
      });

      if (!pipeline) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found" });
      }

      const userRole = (ctx as Record<string, unknown>).userRole as string;

      // When approval is required AND user is EDITOR (not ADMIN/SUPER_ADMIN),
      // block the deploy — deploy-from-version doesn't support approval flow yet
      if (pipeline.environment.requireDeployApproval && userRole === "EDITOR") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Deploy approval is required for this environment. Only admins can deploy directly from a historical version.",
        });
      }

      const result = await deployFromVersion(
        input.pipelineId,
        input.sourceVersionId,
        userId,
        input.changelog,
      );

      // Non-fatal side effects: audit, SSE, event alert
      writeAuditLog({
        userId,
        action: "deploy.from_version",
        entityType: "Pipeline",
        entityId: input.pipelineId,
        metadata: {
          timestamp: new Date().toISOString(),
          input: {
            pipelineId: input.pipelineId,
            sourceVersionId: input.sourceVersionId,
            newVersion: result.version.version,
          },
          pushedNodeIds: result.pushedNodeIds,
        },
        teamId: (ctx as Record<string, unknown>).teamId as string | null ?? null,
        environmentId: pipeline.environment.id,
        ipAddress: (ctx as Record<string, unknown>).ipAddress as string | null ?? null,
        userEmail: ctx.session?.user?.email ?? null,
        userName: ctx.session?.user?.name ?? null,
      }).catch(() => {});

      void fireEventAlert("deploy_completed", pipeline.environment.id, {
        message: `Pipeline "${pipeline.name}" deployed from historical version`,
        pipelineId: input.pipelineId,
      });

      broadcastSSE({
        type: "status_change",
        nodeId: "",
        fromStatus: "",
        toStatus: "DEPLOYED",
        reason: "deploy from version",
        pipelineId: input.pipelineId,
        pipelineName: pipeline.name,
      }, pipeline.environment.id);

      return {
        success: true,
        version: result.version,
        pushedNodeIds: result.pushedNodeIds,
      };
    }),

  environmentInfo: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: {
          environment: {
            include: {
              nodes: {
                select: {
                  id: true,
                  name: true,
                  host: true,
                  apiPort: true,
                  status: true,
                  labels: true,
                },
              },
            },
          },
        },
      });

      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }

      return {
        environmentId: pipeline.environment.id,
        environmentName: pipeline.environment.name,
        requireDeployApproval: pipeline.environment.requireDeployApproval,
        nodes: pipeline.environment.nodes,
      };
    }),

  listPendingRequests: protectedProcedure
    .input(z.object({
      environmentId: z.string().optional(),
      pipelineId: z.string().optional(),
      statuses: z.array(z.enum(["PENDING", "APPROVED"])).optional().default(["PENDING", "APPROVED"]),
    }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      const teamId = (ctx as Record<string, unknown>).teamId as string | null ?? null;
      const where: Record<string, unknown> = {
        status: { in: input.statuses },
        ...(input.environmentId && { environmentId: input.environmentId }),
        ...(input.pipelineId && { pipelineId: input.pipelineId }),
        environment: { teamId },
      };

      const userRole = (ctx as Record<string, unknown>).userRole as string;
      const canReview = userRole === "ADMIN" || userRole === "EDITOR";

      return prisma.deployRequest.findMany({
        where,
        select: {
          id: true,
          pipelineId: true,
          environmentId: true,
          status: true,
          changelog: true,
          nodeSelector: true,
          createdAt: true,
          reviewedAt: true,
          reviewNote: true,
          requestedById: true,
          reviewedById: true,
          // configYaml included for editors/admins who can review
          configYaml: canReview,
          requestedBy: { select: { name: true, email: true } },
          reviewedBy: { select: { name: true, email: true } },
          pipeline: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  approveDeployRequest: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("deployRequest.approved", "DeployRequest"))
    .mutation(async ({ input, ctx }) => {
      const request = await prisma.deployRequest.findUnique({
        where: { id: input.requestId },
      });
      if (!request || request.status !== "PENDING") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deploy request not found or not pending" });
      }
      if (request.requestedById === ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot approve your own deploy request" });
      }

      // Atomically claim the request — prevents double-approval race condition
      const updated = await prisma.deployRequest.updateMany({
        where: { id: input.requestId, status: "PENDING" },
        data: { status: "APPROVED", reviewedById: ctx.session.user.id, reviewedAt: new Date() },
      });
      if (updated.count === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is no longer pending" });
      }

      return { success: true };
    }),

  executeApprovedRequest: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("deployRequest.deployed", "DeployRequest"))
    .mutation(async ({ input, ctx }) => {
      // Atomically claim the APPROVED request — prevents double-deploy race condition
      const updated = await prisma.deployRequest.updateMany({
        where: { id: input.requestId, status: "APPROVED" },
        data: { status: "DEPLOYED", deployedById: ctx.session.user.id, deployedAt: new Date() },
      });
      if (updated.count === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is not in APPROVED state" });
      }

      // Fetch the full request to get configYaml, pipelineId, changelog
      const request = await prisma.deployRequest.findUnique({
        where: { id: input.requestId },
      });
      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deploy request not found" });
      }

      // Deploy the reviewed YAML snapshot — NOT the current pipeline state
      // If deploy fails, revert request status back to APPROVED
      try {
        const result = await deployAgent(
          request.pipelineId,
          request.requestedById ?? ctx.session.user.id,
          request.changelog,
          request.configYaml,
        );

        // Non-throwing failure (e.g. validation errors) — revert to APPROVED
        if (!result.success) {
          await prisma.deployRequest.updateMany({
            where: { id: input.requestId, status: "DEPLOYED" },
            data: { status: "APPROVED", deployedById: null, deployedAt: null },
          });
          return result;
        }

        // Persist nodeSelector from the original deploy request
        if (request.nodeSelector) {
          const ns = request.nodeSelector as Record<string, string>;
          await prisma.pipeline.update({
            where: { id: request.pipelineId },
            data: {
              nodeSelector:
                Object.keys(ns).length > 0 ? ns : Prisma.DbNull,
            },
          });
        }

        void fireEventAlert("deploy_completed", request.environmentId, {
          message: `Pipeline deployed via approved request`,
          pipelineId: request.pipelineId,
        });

        // Fetch pipeline name for SSE event
        const deployedPipeline = await prisma.pipeline.findUnique({
          where: { id: request.pipelineId },
          select: { name: true },
        });

        broadcastSSE({
          type: "status_change",
          nodeId: "",
          fromStatus: "",
          toStatus: "DEPLOYED",
          reason: "deploy request approved and completed",
          pipelineId: request.pipelineId,
          pipelineName: deployedPipeline?.name ?? request.pipelineId,
        }, request.environmentId);

        return result;
      } catch (err) {
        // Revert status back to APPROVED so it can be retried
        await prisma.deployRequest.updateMany({
          where: { id: input.requestId, status: "DEPLOYED" },
          data: { status: "APPROVED", deployedById: null, deployedAt: null },
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Deploy failed — request reverted to approved",
          cause: err,
        });
      }
    }),

  rejectDeployRequest: protectedProcedure
    .input(z.object({ requestId: z.string(), note: z.string().optional() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("deployRequest.rejected", "DeployRequest"))
    .mutation(async ({ input, ctx }) => {
      const request = await prisma.deployRequest.findUnique({ where: { id: input.requestId } });
      if (!request || request.status !== "PENDING") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deploy request not found or not pending" });
      }

      // Atomically reject — prevents race with concurrent approve
      const updated = await prisma.deployRequest.updateMany({
        where: { id: input.requestId, status: "PENDING" },
        data: {
          status: "REJECTED",
          reviewedById: ctx.session.user.id,
          reviewNote: input.note,
          reviewedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is no longer pending" });
      }

      void fireEventAlert("deploy_rejected", request.environmentId, {
        message: `Deploy request rejected`,
        pipelineId: request.pipelineId,
      });

      return { rejected: true };
    }),

  cancelDeployRequest: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("deploy.cancel_request", "DeployRequest"))
    .mutation(async ({ input, ctx }) => {
      // PENDING requests can only be cancelled by the requester.
      // APPROVED requests can be cancelled by anyone with deploy access.
      const request = await prisma.deployRequest.findUnique({
        where: { id: input.requestId },
        select: { status: true, requestedById: true },
      });
      if (!request || !["PENDING", "APPROVED"].includes(request.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is not pending or approved" });
      }
      if (request.status === "PENDING" && request.requestedById !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the requester can cancel a pending request" });
      }

      const updated = await prisma.deployRequest.updateMany({
        where: { id: input.requestId, status: { in: ["PENDING", "APPROVED"] } },
        data: { status: "CANCELLED" },
      });
      if (updated.count === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Request status changed — try again" });
      }

      const cancelledRequest = await prisma.deployRequest.findUnique({
        where: { id: input.requestId },
        select: { environmentId: true, pipelineId: true },
      });
      if (cancelledRequest) {
        void fireEventAlert("deploy_cancelled", cancelledRequest.environmentId, {
          message: `Deploy request cancelled`,
          pipelineId: cancelledRequest.pipelineId,
        });
      }

      return { cancelled: true };
    }),
});
