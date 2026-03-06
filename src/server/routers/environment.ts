import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, requireSuperAdmin } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { generateEnrollmentToken } from "@/server/services/agent-token";
import { encrypt, decrypt } from "@/server/services/crypto";

export const environmentRouter = router({
  list: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.environment.findMany({
        where: { teamId: input.teamId, isSystem: false },
        select: {
          id: true,
          name: true,
          teamId: true,
          createdAt: true,
          _count: { select: { nodes: true, pipelines: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  /** Returns the system environment for super admins */
  getSystem: protectedProcedure
    .use(requireSuperAdmin())
    .query(async () => {
      const env = await prisma.environment.findFirst({
        where: { isSystem: true },
        select: { id: true, name: true, isSystem: true },
      });
      return env;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const environment = await prisma.environment.findUnique({
        where: { id: input.id },
        include: {
          nodes: true,
          _count: { select: { nodes: true, pipelines: true } },
          team: { select: { id: true, name: true } },
        },
      });
      if (!environment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      const { gitToken, enrollmentTokenHash, ...safe } = environment;
      return {
        ...safe,
        hasEnrollmentToken: !!enrollmentTokenHash,
        hasGitToken: !!gitToken,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        teamId: z.string(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("environment.created", "Environment"))
    .mutation(async ({ input }) => {
      // Verify team exists
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
      });
      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team not found",
        });
      }

      return prisma.environment.create({
        data: {
          name: input.name,
          teamId: input.teamId,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        secretBackend: z.enum(["BUILTIN", "VAULT", "AWS_SM", "EXEC"]).optional(),
        secretBackendConfig: z.any().optional(),
        gitRepoUrl: z.string().url().optional().nullable(),
        gitBranch: z.string().min(1).max(100).optional().nullable(),
        gitToken: z.string().optional().nullable(),
      })
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("environment.updated", "Environment"))
    .mutation(async ({ input }) => {
      const { id, gitToken, ...rest } = input;
      const existing = await prisma.environment.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }
      if (existing.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The system environment cannot be modified directly",
        });
      }

      // Build update data, encrypting git token if provided
      const data: Record<string, unknown> = { ...rest };
      if (gitToken !== undefined) {
        data.gitToken = gitToken ? encrypt(gitToken) : null;
      }

      const updated = await prisma.environment.update({
        where: { id },
        data,
      });
      const { gitToken: _gt, enrollmentTokenHash: _eth, ...safeUpdate } = updated;
      return {
        ...safeUpdate,
        hasEnrollmentToken: !!_eth,
        hasGitToken: !!_gt,
      };
    }),

  testGitConnection: protectedProcedure
    .input(z.object({
      environmentId: z.string(),
      repoUrl: z.string().url(),
      branch: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._\/-]+$/),
      token: z.string().min(1).optional(),
    }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("environment.gitConnection.tested", "Environment"))
    .mutation(async ({ input }) => {
      // Resolve token: use provided token, or fall back to stored encrypted token
      let resolvedToken = input.token;
      if (!resolvedToken) {
        const env = await prisma.environment.findUnique({
          where: { id: input.environmentId },
          select: { gitToken: true },
        });
        if (!env?.gitToken) {
          return { success: false, error: "No access token configured" };
        }
        resolvedToken = decrypt(env.gitToken);
      }

      const parsedUrl = new URL(input.repoUrl);
      if (parsedUrl.protocol !== "https:") {
        return { success: false, error: "Only HTTPS repository URLs are supported" };
      }

      const simpleGit = (await import("simple-git")).default;
      const { mkdtemp, rm } = await import("fs/promises");
      const { join } = await import("path");
      const { tmpdir } = await import("os");

      let workdir: string | null = null;
      try {
        workdir = await mkdtemp(join(tmpdir(), "vf-git-test-"));
        const repoDir = join(workdir, "repo");
        const git = simpleGit(workdir);
        parsedUrl.username = resolvedToken;
        parsedUrl.password = "";
        await git.clone(parsedUrl.toString(), repoDir, [
          "--branch", input.branch,
          "--depth", "1",
          "--single-branch",
        ]);
        return { success: true };
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const sanitized = raw.replace(/https?:\/\/[^@\s]+@/g, "https://[redacted]@");
        return {
          success: false,
          error: sanitized,
        };
      } finally {
        if (workdir) {
          await rm(workdir, { recursive: true, force: true }).catch(() => {});
        }
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.deleted", "Environment"))
    .mutation(async ({ input }) => {
      const existing = await prisma.environment.findUnique({
        where: { id: input.id },
        include: { pipelines: { select: { id: true } } },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }
      if (existing.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The system environment cannot be deleted",
        });
      }
      const pipelineIds = existing.pipelines.map((p) => p.id);
      return prisma.$transaction([
        // PipelineVersion lacks onDelete: Cascade, clean up explicitly
        prisma.pipelineVersion.deleteMany({ where: { pipelineId: { in: pipelineIds } } }),
        prisma.pipeline.deleteMany({ where: { environmentId: input.id } }),
        prisma.vectorNode.deleteMany({ where: { environmentId: input.id } }),
        prisma.environment.delete({ where: { id: input.id } }),
      ]);
    }),

  generateEnrollmentToken: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.enrollmentToken.generated", "Environment"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }
      const { token, hash, hint } = await generateEnrollmentToken();
      await prisma.environment.update({
        where: { id: input.environmentId },
        data: {
          enrollmentTokenHash: hash,
          enrollmentTokenHint: hint,
        },
      });

      return { token, hint };
    }),

  revokeEnrollmentToken: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.enrollmentToken.revoked", "Environment"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }

      await prisma.environment.update({
        where: { id: input.environmentId },
        data: {
          enrollmentTokenHash: null,
          enrollmentTokenHint: null,
        },
      });

      return { success: true };
    }),
});
