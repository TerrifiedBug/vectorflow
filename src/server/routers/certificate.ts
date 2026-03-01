import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/server/services/crypto";
import { withAudit } from "@/server/middleware/audit";

const MAX_CERT_SIZE = 100 * 1024; // 100KB

export const certificateRouter = router({
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.certificate.findMany({
        where: { environmentId: input.environmentId },
        select: { id: true, name: true, filename: true, fileType: true, createdAt: true },
        orderBy: { name: "asc" },
      });
    }),

  upload: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(100).regex(
          /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
          "Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores",
        ),
        filename: z.string().min(1),
        fileType: z.enum(["ca", "cert", "key"]),
        dataBase64: z.string().min(1),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("certificate.uploaded", "Certificate"))
    .mutation(async ({ input }) => {
      const data = Buffer.from(input.dataBase64, "base64").toString("utf-8");

      if (Buffer.byteLength(data) > MAX_CERT_SIZE) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Certificate file exceeds 100KB limit" });
      }

      if (!data.includes("-----BEGIN ")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid certificate format. Expected PEM-encoded file." });
      }

      const existing = await prisma.certificate.findUnique({
        where: { environmentId_name: { environmentId: input.environmentId, name: input.name } },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A certificate with this name already exists in this environment" });
      }

      return prisma.certificate.create({
        data: {
          name: input.name,
          filename: input.filename,
          fileType: input.fileType,
          encryptedData: encrypt(data),
          environmentId: input.environmentId,
        },
        select: { id: true, name: true, filename: true, fileType: true, createdAt: true },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), environmentId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("certificate.deleted", "Certificate"))
    .mutation(async ({ input }) => {
      const cert = await prisma.certificate.findUnique({ where: { id: input.id } });
      if (!cert || cert.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      }
      await prisma.certificate.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  /** Internal: get decrypted cert data for deploy */
  getData: protectedProcedure
    .input(z.object({ id: z.string(), environmentId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .query(async ({ input }) => {
      const cert = await prisma.certificate.findUnique({ where: { id: input.id } });
      if (!cert || cert.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      }
      return { data: decrypt(cert.encryptedData), filename: cert.filename };
    }),
});
