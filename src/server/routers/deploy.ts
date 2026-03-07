import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { deployAgent, undeployAgent } from "@/server/services/deploy-agent";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { withAudit } from "@/server/middleware/audit";
import { writeAuditLog } from "@/server/services/audit";

export const deployRouter = router({
  preview: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        include: { nodes: true, edges: true },
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

      const configYaml = generateVectorYaml(
        flowNodes as Parameters<typeof generateVectorYaml>[0],
        flowEdges as Parameters<typeof generateVectorYaml>[1],
        pipeline.globalConfig as Record<string, unknown> | null,
      );
      const validation = await validateConfig(configYaml);

      const latestVersion = await prisma.pipelineVersion.findFirst({
        where: { pipelineId: input.pipelineId },
        orderBy: { version: "desc" },
        select: { configYaml: true, version: true, logLevel: true },
      });

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
          environment: { select: { id: true, requireDeployApproval: true } },
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

        const configYaml = generateVectorYaml(
          flowNodes as Parameters<typeof generateVectorYaml>[0],
          flowEdges as Parameters<typeof generateVectorYaml>[1],
          pipeline.globalConfig as Record<string, unknown> | null,
        );

        const validation = await validateConfig(configYaml);
        if (!validation.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid pipeline configuration: " + (validation.errors?.map((e: { message: string }) => e.message).join(", ") ?? "unknown error"),
          });
        }

        // Prevent duplicate pending requests for the same pipeline
        const existingPending = await prisma.deployRequest.findFirst({
          where: { pipelineId: input.pipelineId, status: "PENDING" },
        });
        if (existingPending) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A pending deploy request already exists for this pipeline",
          });
        }

        const request = await prisma.deployRequest.create({
          data: {
            pipelineId: input.pipelineId,
            environmentId: pipeline.environment.id,
            requestedById: userId,
            configYaml,
            changelog: input.changelog,
            nodeSelector: input.nodeSelector ?? undefined,
          },
        });

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

      if (result.success) {
        writeAuditLog({
          userId,
          action: "deploy.agent",
          entityType: "Pipeline",
          entityId: input.pipelineId,
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

      return undeployAgent(input.pipelineId);
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
    }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input, ctx }) => {
      const where: Record<string, unknown> = { status: "PENDING" };
      if (input.environmentId) where.environmentId = input.environmentId;
      if (input.pipelineId) where.pipelineId = input.pipelineId;

      const userRole = (ctx as Record<string, unknown>).userRole as string;
      const isAdmin = userRole === "ADMIN" || userRole === "SUPER_ADMIN";

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
          // configYaml only included for admins — contains decrypted secrets
          configYaml: isAdmin,
          requestedBy: { select: { name: true, email: true } },
          pipeline: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  approveDeployRequest: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("deployRequest.approved", "DeployRequest"))
    .mutation(async ({ input, ctx }) => {
      const request = await prisma.deployRequest.findUnique({
        where: { id: input.requestId },
        include: { pipeline: true },
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

      // Deploy the reviewed YAML snapshot — NOT the current pipeline state
      // If deploy fails, revert request status to PENDING so it can be retried
      try {
        const result = await deployAgent(
          request.pipelineId,
          request.requestedById,
          request.changelog,
          request.configYaml,
        );

        // Persist nodeSelector from the original deploy request
        if (result.success && request.nodeSelector) {
          const ns = request.nodeSelector as Record<string, string>;
          await prisma.pipeline.update({
            where: { id: request.pipelineId },
            data: {
              nodeSelector:
                Object.keys(ns).length > 0 ? ns : Prisma.DbNull,
            },
          });
        }

        return result;
      } catch (err) {
        await prisma.deployRequest.updateMany({
          where: { id: input.requestId, status: "APPROVED" },
          data: { status: "PENDING", reviewedById: null, reviewedAt: null },
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Deploy failed after approval — request reverted to pending",
          cause: err,
        });
      }
    }),

  rejectDeployRequest: protectedProcedure
    .input(z.object({ requestId: z.string(), note: z.string().optional() }))
    .use(withTeamAccess("ADMIN"))
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

      return { rejected: true };
    }),

  cancelDeployRequest: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("deploy.cancel_request", "DeployRequest"))
    .mutation(async ({ input, ctx }) => {
      const updated = await prisma.deployRequest.updateMany({
        where: { id: input.requestId, status: "PENDING", requestedById: ctx.session.user.id },
        data: { status: "CANCELLED" },
      });
      if (updated.count === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is no longer pending or not owned by you" });
      }

      return { cancelled: true };
    }),
});
