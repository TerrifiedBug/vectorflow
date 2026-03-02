import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { deployAgent, undeployAgent } from "@/server/services/deploy-agent";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { withAudit } from "@/server/middleware/audit";

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
        flowNodes as any,
        flowEdges as any,
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
        currentLogLevel: latestVersion?.logLevel ?? null,
        newLogLevel: (pipeline.globalConfig as Record<string, unknown>)?.log_level as string ?? null,
      };
    }),

  agent: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("deploy.agent", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      return deployAgent(input.pipelineId, userId);
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
        nodes: pipeline.environment.nodes,
      };
    }),
});
