import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { parseFluentdConfig } from "@/server/services/migration/fluentd-parser";
import { computeReadiness } from "@/server/services/migration/readiness";
import { translateBlocks, translateBlocksAsync } from "@/server/services/migration/ai-translator";
import { generatePipeline } from "@/server/services/migration/pipeline-generator";
import type { ParsedConfig, TranslationResult } from "@/server/services/migration/types";
import { Prisma } from "@/generated/prisma";
import { errorLog } from "@/lib/logger";

export const migrationRouter = router({
  /** List all migration projects for a team */
  list: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const projects = await prisma.migrationProject.findMany({
        where: { teamId: input.teamId },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          platform: true,
          status: true,
          readinessScore: true,
          generatedPipelineId: true,
          createdAt: true,
          updatedAt: true,
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      return projects;
    }),

  /** Get a single migration project by ID */
  get: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const project = await prisma.migrationProject.findUnique({
        where: { id: input.id },
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          generatedPipeline: {
            select: { id: true, name: true },
          },
        },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Migration project not found",
        });
      }

      if (project.teamId !== input.teamId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Migration project does not belong to this team",
        });
      }

      return project;
    }),

  /** Create a new migration project */
  create: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string().min(1).max(200),
        platform: z.enum(["FLUENTD"]),
        originalConfig: z.string().min(1).max(500_000), // 500KB max
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("migration.created", "MigrationProject"))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User ID not available",
        });
      }

      const project = await prisma.migrationProject.create({
        data: {
          name: input.name,
          teamId: input.teamId,
          platform: input.platform,
          originalConfig: input.originalConfig,
          status: "DRAFT",
          createdById: userId,
        },
      });

      return project;
    }),

  /** Delete a migration project */
  delete: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("migration.deleted", "MigrationProject"))
    .mutation(async ({ input }) => {
      const project = await prisma.migrationProject.findUnique({
        where: { id: input.id },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Migration project not found",
        });
      }

      if (project.teamId !== input.teamId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Migration project does not belong to this team",
        });
      }

      await prisma.migrationProject.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /** Parse the uploaded config and compute readiness */
  parse: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const project = await prisma.migrationProject.findUnique({
        where: { id: input.id },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Migration project not found",
        });
      }

      if (project.teamId !== input.teamId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Migration project does not belong to this team",
        });
      }

      // Update status to PARSING
      await prisma.migrationProject.update({
        where: { id: input.id },
        data: { status: "PARSING" },
      });

      try {
        // Parse based on platform
        let parsedConfig: ParsedConfig;
        if (project.platform === "FLUENTD") {
          parsedConfig = parseFluentdConfig(project.originalConfig);
        } else {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Unsupported platform: ${project.platform}`,
          });
        }

        // Compute readiness
        const readinessReport = computeReadiness(parsedConfig);

        // Update the project with parsed data
        const updated = await prisma.migrationProject.update({
          where: { id: input.id },
          data: {
            parsedTopology: parsedConfig as unknown as Prisma.InputJsonValue,
            pluginInventory: readinessReport.pluginInventory as unknown as Prisma.InputJsonValue,
            readinessScore: readinessReport.score,
            readinessReport: readinessReport as unknown as Prisma.InputJsonValue,
            status: "DRAFT",
          },
        });

        return {
          parsedTopology: updated.parsedTopology,
          readinessScore: updated.readinessScore,
          readinessReport: updated.readinessReport,
          pluginInventory: updated.pluginInventory,
        };
      } catch (err) {
        // If parsing fails, set status to FAILED
        await prisma.migrationProject.update({
          where: { id: input.id },
          data: {
            status: "FAILED",
            errorMessage: err instanceof Error ? err.message : "Parsing failed",
          },
        });
        throw err;
      }
    }),

  /** Translate parsed blocks to Vector config using AI */
  translate: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("migration.translated", "MigrationProject"))
    .mutation(async ({ input }) => {
      const project = await prisma.migrationProject.findUnique({
        where: { id: input.id },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Migration project not found",
        });
      }

      if (project.teamId !== input.teamId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Migration project does not belong to this team",
        });
      }

      if (!project.parsedTopology) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Config must be parsed before translation. Run parse first.",
        });
      }

      // Check if AI is configured for this team
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { aiEnabled: true, aiApiKey: true },
      });

      if (!team?.aiEnabled || !team.aiApiKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "AI is not configured for this team. Configure an AI provider in Settings to enable auto-translation.",
        });
      }

      await prisma.migrationProject.update({
        where: { id: input.id },
        data: { status: "TRANSLATING" },
      });

      try {
        const parsedConfig = project.parsedTopology as unknown as ParsedConfig;

        const translationResult = await translateBlocks({
          teamId: input.teamId,
          parsedConfig,
          platform: project.platform,
        });

        // Update status to VALIDATING, then validate
        await prisma.migrationProject.update({
          where: { id: input.id },
          data: {
            translatedBlocks: translationResult as unknown as Prisma.InputJsonValue,
            validationResult: Prisma.JsonNull,
            status: "READY",
          },
        });

        return translationResult;
      } catch (err) {
        await prisma.migrationProject.update({
          where: { id: input.id },
          data: {
            status: "FAILED",
            errorMessage: err instanceof Error ? err.message : "Translation failed",
          },
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Translation failed",
        });
      }
    }),

  /** Validate translated config using vector validate */
  validate: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const project = await prisma.migrationProject.findUnique({
        where: { id: input.id },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Migration project not found",
        });
      }

      if (!project.translatedBlocks) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Config must be translated before validation.",
        });
      }

      await prisma.migrationProject.update({
        where: { id: input.id },
        data: { status: "VALIDATING" },
      });

      try {
        const { validateConfig } = await import("@/server/services/validator");
        const translationResult = project.translatedBlocks as unknown as TranslationResult;

        const validationResult = await validateConfig(translationResult.vectorYaml);

        await prisma.migrationProject.update({
          where: { id: input.id },
          data: {
            validationResult: validationResult as unknown as Prisma.InputJsonValue,
            status: validationResult.valid ? "READY" : "FAILED",
            errorMessage: validationResult.valid
              ? null
              : validationResult.errors.map((e: { message: string }) => e.message).join("; "),
          },
        });

        return validationResult;
      } catch (err) {
        await prisma.migrationProject.update({
          where: { id: input.id },
          data: {
            status: "FAILED",
            errorMessage: err instanceof Error ? err.message : "Validation failed",
          },
        });
        throw err;
      }
    }),

  /** Re-translate a single block with AI (for manual retry) */
  retranslateBlock: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        teamId: z.string(),
        blockId: z.string(),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const project = await prisma.migrationProject.findUnique({
        where: { id: input.id },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Migration project not found",
        });
      }

      if (project.teamId !== input.teamId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Migration project does not belong to this team",
        });
      }

      if (!project.parsedTopology) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Config must be parsed first.",
        });
      }

      const parsedConfig = project.parsedTopology as unknown as ParsedConfig;
      const targetBlock = parsedConfig.blocks.find((b) => b.id === input.blockId);

      if (!targetBlock) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Block not found in parsed config",
        });
      }

      const { translateSingleBlock } = await import(
        "@/server/services/migration/ai-translator"
      );

      const translatedBlock = await translateSingleBlock({
        teamId: input.teamId,
        block: targetBlock,
        parsedConfig,
        platform: project.platform,
      });

      // Update the block in the existing translatedBlocks
      const existingResult = (project.translatedBlocks ?? {
        blocks: [],
        vectorYaml: "",
        overallConfidence: 0,
        warnings: [],
      }) as unknown as TranslationResult;

      const updatedBlocks = existingResult.blocks.map((b) =>
        b.blockId === input.blockId ? translatedBlock : b,
      );

      // If block wasn't in existing results, add it
      if (!existingResult.blocks.some((b) => b.blockId === input.blockId)) {
        updatedBlocks.push(translatedBlock);
      }

      const { assembleVectorYaml } = await import(
        "@/server/services/migration/translation-assembler"
      );

      const updatedResult: TranslationResult = {
        blocks: updatedBlocks,
        vectorYaml: assembleVectorYaml(updatedBlocks),
        overallConfidence: Math.round(
          updatedBlocks.reduce((sum, b) => sum + b.confidence, 0) /
            updatedBlocks.length,
        ),
        warnings: existingResult.warnings,
      };

      await prisma.migrationProject.update({
        where: { id: input.id },
        data: {
          translatedBlocks: updatedResult as unknown as Prisma.InputJsonValue,
        },
      });

      return translatedBlock;
    }),

  /** Generate a VectorFlow pipeline from translated blocks */
  generate: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        teamId: z.string(),
        environmentId: z.string(),
        pipelineName: z.string().min(1).max(200),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("migration.generated", "MigrationProject"))
    .mutation(async ({ input }) => {
      const project = await prisma.migrationProject.findUnique({
        where: { id: input.id },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Migration project not found",
        });
      }

      if (project.teamId !== input.teamId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Migration project does not belong to this team",
        });
      }

      if (!project.translatedBlocks) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Config must be translated before generating a pipeline.",
        });
      }

      // Verify environment belongs to the team
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { teamId: true },
      });

      if (!env || env.teamId !== input.teamId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found or does not belong to this team",
        });
      }

      await prisma.migrationProject.update({
        where: { id: input.id },
        data: { status: "GENERATING" },
      });

      try {
        const translationResult = project.translatedBlocks as unknown as TranslationResult;

        const pipeline = await generatePipeline({
          translationResult,
          environmentId: input.environmentId,
          pipelineName: input.pipelineName,
          migrationProjectId: input.id,
        });

        await prisma.migrationProject.update({
          where: { id: input.id },
          data: {
            generatedPipelineId: pipeline.id,
            status: "COMPLETED",
          },
        });

        return { pipelineId: pipeline.id };
      } catch (err) {
        await prisma.migrationProject.update({
          where: { id: input.id },
          data: {
            status: "FAILED",
            errorMessage: err instanceof Error ? err.message : "Pipeline generation failed",
          },
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Pipeline generation failed",
        });
      }
    }),

  /** Update translated block config manually (user edits) */
  updateBlockConfig: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        teamId: z.string(),
        blockId: z.string(),
        config: z.record(z.string(), z.unknown()),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const project = await prisma.migrationProject.findUnique({
        where: { id: input.id },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Migration project not found",
        });
      }

      if (project.teamId !== input.teamId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Migration project does not belong to this team",
        });
      }

      if (!project.translatedBlocks) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No translated blocks to update.",
        });
      }

      const result = project.translatedBlocks as unknown as TranslationResult;
      const updatedBlocks = result.blocks.map((b) =>
        b.blockId === input.blockId
          ? { ...b, config: input.config }
          : b,
      );

      const { assembleVectorYaml } = await import(
        "@/server/services/migration/translation-assembler"
      );

      const updatedResult: TranslationResult = {
        ...result,
        blocks: updatedBlocks,
        vectorYaml: assembleVectorYaml(updatedBlocks),
      };

      await prisma.migrationProject.update({
        where: { id: input.id },
        data: {
          translatedBlocks: updatedResult as unknown as Prisma.InputJsonValue,
        },
      });

      return { success: true };
    }),

  /** Kick off async AI translation — returns immediately with status TRANSLATING */
  startTranslation: protectedProcedure
    .input(z.object({ id: z.string(), teamId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const project = await prisma.migrationProject.findUnique({
        where: { id: input.id },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Migration project not found",
        });
      }

      if (project.teamId !== input.teamId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Migration project does not belong to this team",
        });
      }

      if (!project.parsedTopology) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Config must be parsed before translation. Run parse first.",
        });
      }

      if (project.status === "TRANSLATING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Translation is already in progress.",
        });
      }

      // Check if AI is configured for this team
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { aiEnabled: true, aiApiKey: true },
      });

      if (!team?.aiEnabled || !team.aiApiKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "AI is not configured for this team. Configure an AI provider in Settings to enable auto-translation.",
        });
      }

      await prisma.migrationProject.update({
        where: { id: input.id },
        data: { status: "TRANSLATING" },
      });

      const parsedConfig = project.parsedTopology as unknown as ParsedConfig;

      // Fire-and-forget — do NOT await
      translateBlocksAsync({
        projectId: input.id,
        teamId: input.teamId,
        parsedConfig,
        platform: project.platform,
      }).catch((err) => {
        errorLog(
          "migration.startTranslation",
          `Async translation failed for project ${input.id}`,
          err,
        );
      });

      return { status: "TRANSLATING" as const };
    }),
});
