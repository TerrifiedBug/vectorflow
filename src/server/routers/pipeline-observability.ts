import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { LogLevel } from "@/generated/prisma";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { evaluatePipelineHealth } from "@/server/services/sli-evaluator";
import { batchEvaluatePipelineHealth } from "@/server/services/batch-health";
import { relayPush } from "@/server/services/push-broadcast";

export const pipelineObservabilityRouter = router({
  metrics: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        hours: z.number().min(1).max(168).default(24),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);

      return prisma.pipelineMetric.findMany({
        where: {
          pipelineId: input.pipelineId,
          nodeId: null,
          componentId: null,
          timestamp: { gte: since },
        },
        orderBy: { timestamp: "asc" },
        select: {
          timestamp: true,
          eventsIn: true,
          eventsOut: true,
          eventsDiscarded: true,
          errorsTotal: true,
          bytesIn: true,
          bytesOut: true,
          utilization: true,
          latencyMeanMs: true,
        },
      });
    }),

  logs: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(500).default(200),
        levels: z.array(z.nativeEnum(LogLevel)).optional(),
        nodeId: z.string().optional(),
        since: z.date().optional(),
        search: z.string().max(200).optional(),
      }),
    )
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const { pipelineId, cursor, limit, levels, nodeId, since, search } = input;
      const take = limit;

      const where: Record<string, unknown> = { pipelineId };
      if (levels && levels.length > 0) {
        where.level = { in: levels };
      }
      if (nodeId) {
        where.nodeId = nodeId;
      }
      if (since) {
        where.timestamp = { gte: since };
      }
      if (search) {
        where.message = { contains: search, mode: "insensitive" };
      }

      const items = await prisma.pipelineLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          node: { select: { name: true } },
          pipeline: { select: { name: true } },
        },
      });

      let nextCursor: string | undefined;
      if (items.length > take) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id;
      }

      return { items, nextCursor };
    }),

  requestSamples: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        componentKeys: z.array(z.string()),
        limit: z.number().min(1).max(50).default(5),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: input.pipelineId },
        select: { id: true, isDraft: true, deployedAt: true },
      });
      if (!pipeline) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pipeline not found",
        });
      }
      if (pipeline.isDraft || !pipeline.deployedAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Pipeline must be deployed to sample events",
        });
      }

      const request = await prisma.eventSampleRequest.create({
        data: {
          pipelineId: input.pipelineId,
          componentKeys: input.componentKeys,
          limit: input.limit,
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        },
      });

      // Push sample request to connected agents running this pipeline
      const statuses = await prisma.nodePipelineStatus.findMany({
        where: { pipelineId: input.pipelineId, status: "RUNNING" },
        select: { nodeId: true },
      });
      for (const { nodeId } of statuses) {
        relayPush(nodeId, {
          type: "sample_request",
          requestId: request.id,
          pipelineId: input.pipelineId,
          componentKeys: input.componentKeys,
          limit: input.limit,
        });
      }

      return { requestId: request.id, status: "PENDING" };
    }),

  sampleResult: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const request = await prisma.eventSampleRequest.findUnique({
        where: { id: input.requestId },
        include: {
          samples: {
            select: {
              id: true,
              componentKey: true,
              events: true,
              schema: true,
              error: true,
              sampledAt: true,
            },
          },
        },
      });
      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sample request not found",
        });
      }

      return {
        requestId: request.id,
        status: request.status,
        samples: request.samples,
      };
    }),

  eventSchemas: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .query(async ({ input }) => {
      const samples = await prisma.eventSample.findMany({
        where: {
          pipelineId: input.pipelineId,
          error: null,
        },
        orderBy: { sampledAt: "desc" },
        select: {
          componentKey: true,
          schema: true,
          events: true,
          sampledAt: true,
        },
      });

      // Deduplicate: keep only the most recent sample per componentKey
      const seen = new Set<string>();
      const deduplicated = [];
      for (const sample of samples) {
        if (!seen.has(sample.componentKey)) {
          seen.add(sample.componentKey);
          deduplicated.push(sample);
        }
      }

      return deduplicated;
    }),

  listSlis: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.pipelineSli.findMany({
        where: { pipelineId: input.pipelineId },
        orderBy: { createdAt: "asc" },
      });
    }),

  upsertSli: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        metric: z.enum(["error_rate", "throughput_floor", "discard_rate"]),
        condition: z.enum(["lt", "gt"]),
        threshold: z.number().min(0),
        windowMinutes: z.number().int().min(1).max(1440).default(5),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.sli_upserted", "Pipeline"))
    .mutation(async ({ input }) => {
      return prisma.pipelineSli.upsert({
        where: {
          pipelineId_metric: {
            pipelineId: input.pipelineId,
            metric: input.metric,
          },
        },
        update: {
          condition: input.condition,
          threshold: input.threshold,
          windowMinutes: input.windowMinutes,
        },
        create: {
          pipelineId: input.pipelineId,
          metric: input.metric,
          condition: input.condition,
          threshold: input.threshold,
          windowMinutes: input.windowMinutes,
        },
      });
    }),

  deleteSli: protectedProcedure
    .input(z.object({ id: z.string(), pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.sli_deleted", "Pipeline"))
    .mutation(async ({ input }) => {
      const sli = await prisma.pipelineSli.findUnique({
        where: { id: input.id },
      });
      if (!sli || sli.pipelineId !== input.pipelineId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SLI not found",
        });
      }
      return prisma.pipelineSli.delete({
        where: { id: input.id },
      });
    }),

  health: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return evaluatePipelineHealth(input.pipelineId);
    }),

  batchHealth: protectedProcedure
    .input(z.object({ pipelineIds: z.array(z.string()).max(200) }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return batchEvaluatePipelineHealth(input.pipelineIds);
    }),
});
