import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/server/services/crypto";
import { createHash } from "crypto";
import { withAudit } from "@/server/middleware/audit";

export const environmentRouter = router({
  list: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.environment.findMany({
        where: { teamId: input.teamId },
        select: {
          id: true,
          name: true,
          teamId: true,
          gitRepo: true,
          gitBranch: true,
          gitCommitAuthor: true,
          createdAt: true,
          _count: { select: { nodes: true, pipelines: true } },
        },
        orderBy: { createdAt: "desc" },
      });
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

      let sshKeyFingerprint: string | null = null;
      if (environment.gitSshKey) {
        try {
          const hash = createHash("sha256").update(environment.gitSshKey).digest("base64");
          sshKeyFingerprint = `SHA256:${hash}`;
        } catch {}
      }

      // Destructure to exclude raw credential fields (Bytes can't serialize)
      const { gitSshKey, gitHttpsToken, ...safe } = environment;

      return {
        ...safe,
        hasSshKey: !!gitSshKey,
        hasHttpsToken: !!gitHttpsToken,
        sshKeyFingerprint,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        teamId: z.string(),
        gitRepo: z.string().optional(),
        gitBranch: z.string().optional(),
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
          gitRepo: input.gitRepo,
          gitBranch: input.gitBranch,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        gitRepo: z.string().nullable().optional(),
        gitBranch: z.string().nullable().optional(),
        gitCommitAuthor: z.string().nullable().optional(),
      })
    )
    .use(withAudit("environment.updated", "Environment"))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const existing = await prisma.environment.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }
      return prisma.environment.update({
        where: { id },
        data,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withAudit("environment.deleted", "Environment"))
    .mutation(async ({ input }) => {
      const existing = await prisma.environment.findUnique({
        where: { id: input.id },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }
      return prisma.environment.delete({
        where: { id: input.id },
      });
    }),

  uploadSshKey: protectedProcedure
    .input(z.object({ environmentId: z.string(), keyBase64: z.string().min(1) }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const keyBuffer = Buffer.from(input.keyBase64, "base64");
      const keyText = keyBuffer.toString("utf8");
      if (!keyText.includes("PRIVATE KEY")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This does not appear to be a private key. Upload the private key file (not .pub).",
        });
      }
      const encryptedKey = encrypt(keyText);
      return prisma.environment.update({
        where: { id: input.environmentId },
        data: { gitSshKey: Buffer.from(encryptedKey, "utf8") },
      });
    }),

  updateHttpsToken: protectedProcedure
    .input(z.object({ environmentId: z.string(), token: z.string().min(1) }))
    .use(withTeamAccess("EDITOR"))
    .mutation(async ({ input }) => {
      const encryptedToken = encrypt(input.token);
      return prisma.environment.update({
        where: { id: input.environmentId },
        data: { gitHttpsToken: encryptedToken },
      });
    }),
});
