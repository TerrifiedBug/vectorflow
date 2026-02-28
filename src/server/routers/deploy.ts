import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { deployApiReload } from "@/server/services/deploy";
import { deployGitOps } from "@/server/services/deploy-gitops";
import { generateVectorYaml } from "@/lib/config-generator";
import { validateConfig } from "@/server/services/validator";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { withAudit } from "@/server/middleware/audit";

export const deployRouter = router({
  /**
   * Preview: generate YAML and validate without deploying.
   * Returns the generated config and validation result.
   */
  preview: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
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
      );
      const validation = await validateConfig(configYaml);

      // Get the currently deployed config (latest version) for diff
      const latestVersion = await prisma.pipelineVersion.findFirst({
        where: { pipelineId: input.pipelineId },
        orderBy: { version: "desc" },
        select: { configYaml: true, version: true },
      });

      return {
        configYaml,
        validation,
        currentConfigYaml: latestVersion?.configYaml ?? null,
        currentVersion: latestVersion?.version ?? null,
      };
    }),

  /**
   * Deploy via API reload to all Vector nodes in the environment.
   */
  apiReload: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        environmentId: z.string(),
      }),
    )
    .use(withAudit("deploy.api_reload", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return deployApiReload(input.pipelineId, input.environmentId, userId);
    }),

  /**
   * Deploy via GitOps — commit config to a git repo.
   */
  gitops: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        environmentId: z.string(),
        repoUrl: z.string().min(1),
        branch: z.string().min(1),
        commitAuthor: z.string().optional(),
      }),
    )
    .use(withAudit("deploy.gitops", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      // Load git credentials from system settings
      const settings = await prisma.systemSettings.findUnique({
        where: { id: "singleton" },
      });

      const { decrypt } = await import("@/server/services/crypto");
      const isHttps = input.repoUrl.startsWith("https://");

      let sshKey: string | undefined;
      if (settings?.gitopsSshKey) {
        try {
          sshKey = decrypt(Buffer.from(settings.gitopsSshKey).toString("utf8"));
        } catch (err) {
          console.error("Failed to decrypt SSH key:", err);
        }
      }

      let httpsToken: string | undefined;
      if (settings?.gitopsHttpsToken) {
        try {
          httpsToken = decrypt(settings.gitopsHttpsToken);
        } catch (err) {
          console.error("Failed to decrypt HTTPS token:", err);
        }
      }

      // Log credential status for debugging
      console.log(`GitOps deploy: URL scheme=${isHttps ? "HTTPS" : "SSH"}, hasKey=${!!sshKey}, hasToken=${!!httpsToken}`);
      if (sshKey) {
        console.log(`SSH key: ${sshKey.length} chars, starts with "${sshKey.substring(0, 30)}..."`);
      }

      // Validate credentials match the URL scheme
      if (isHttps && !httpsToken) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "HTTPS repository requires a personal access token. Configure one in Settings → GitOps → HTTPS Token.",
        });
      }
      if (!isHttps && !sshKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "SSH repository requires a deploy key. Upload one in Settings → GitOps → SSH Key.",
        });
      }

      return deployGitOps(input.pipelineId, input.environmentId, userId, {
        repoUrl: input.repoUrl,
        branch: input.branch,
        commitAuthor: input.commitAuthor || settings?.gitopsCommitAuthor || undefined,
        sshKey,
        httpsToken,
      });
    }),

  /**
   * Get environment info for the deploy wizard.
   */
  environmentInfo: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
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
        deployMode: pipeline.environment.deployMode,
        gitRepo: pipeline.environment.gitRepo,
        gitBranch: pipeline.environment.gitBranch,
        nodes: pipeline.environment.nodes,
      };
    }),
});
