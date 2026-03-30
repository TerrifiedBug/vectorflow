import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/server/services/crypto";
import { parseCertExpiry, daysUntilExpiry } from "@/server/services/cert-expiry-checker";
import { withAudit } from "@/server/middleware/audit";

const MAX_CERT_SIZE = 100 * 1024; // 100KB

export const certificateRouter = router({
  list: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const certs = await prisma.certificate.findMany({
        where: { environmentId: input.environmentId },
        select: {
          id: true,
          name: true,
          filename: true,
          fileType: true,
          createdAt: true,
          encryptedData: true,
        },
      });

      const now = new Date();

      const enriched = certs.map((cert) => {
        let expiryDate: string | null = null;
        let days: number | null = null;

        if (cert.fileType === "cert" || cert.fileType === "ca") {
          try {
            const pem = decrypt(cert.encryptedData);
            const expiry = parseCertExpiry(pem);
            if (expiry) {
              expiryDate = expiry.toISOString();
              days = Math.round(daysUntilExpiry(expiry, now));
            }
          } catch {
            // Decryption or parse failure — leave as null
          }
        }

        return {
          id: cert.id,
          name: cert.name,
          filename: cert.filename,
          fileType: cert.fileType,
          createdAt: cert.createdAt,
          expiryDate,
          daysUntilExpiry: days,
        };
      });

      enriched.sort((a, b) => {
        if (a.daysUntilExpiry === null && b.daysUntilExpiry === null) return a.name.localeCompare(b.name);
        if (a.daysUntilExpiry === null) return 1;
        if (b.daysUntilExpiry === null) return -1;
        return a.daysUntilExpiry - b.daysUntilExpiry;
      });

      return enriched;
    }),

  upload: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: z.string().min(1).max(100).regex(
          /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
          "Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores",
        ),
        filename: z.string().min(1).max(255).regex(
          /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
          "Filename must start with a letter or number and contain only letters, numbers, dots, hyphens, and underscores",
        ),
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
    .use(withAudit("certificate.accessed", "Certificate"))
    .query(async ({ input }) => {
      const cert = await prisma.certificate.findUnique({ where: { id: input.id } });
      if (!cert || cert.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      }
      return { data: decrypt(cert.encryptedData), filename: cert.filename };
    }),
});
