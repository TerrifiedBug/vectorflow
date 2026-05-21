import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/server/services/crypto";
import { parseCertExpiry, daysUntilExpiry } from "@/server/services/cert-expiry-checker";
import { withAudit } from "@/server/middleware/audit";
import { decryptNodeConfig } from "@/server/services/config-crypto";
import { collectCertRefs } from "@/server/services/secret-resolver";

const MAX_CERT_SIZE = 100 * 1024; // 100KB
const certificateNameSchema = z.string().min(1).max(100).regex(
  /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
  "Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores",
);
const bundleCertIdSchema = z.string().min(1).nullable().optional();

const certificateBundleSelect = {
  id: true,
  name: true,
  environmentId: true,
  caId: true,
  certId: true,
  keyId: true,
  createdAt: true,
  updatedAt: true,
  ca: { select: { id: true, name: true, filename: true, fileType: true } },
  cert: { select: { id: true, name: true, filename: true, fileType: true } },
  key: { select: { id: true, name: true, filename: true, fileType: true } },
} as const;

async function validateBundleCertificates(
  environmentId: string,
  input: { caId?: string | null; certId?: string | null; keyId?: string | null },
) {
  const certIds = Array.from(
    new Set(
      [input.caId ?? null, input.certId ?? null, input.keyId ?? null].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );

  if (certIds.length === 0) return;

  const certificates = await prisma.certificate.findMany({
    where: { id: { in: certIds } },
    select: { id: true, environmentId: true, fileType: true },
  });
  const byId = new Map(certificates.map((certificate) => [certificate.id, certificate]));

  const checks = [
    { id: input.caId ?? null, expectedType: "ca", label: "CA certificate" },
    { id: input.certId ?? null, expectedType: "cert", label: "certificate" },
    { id: input.keyId ?? null, expectedType: "key", label: "private key" },
  ] as const;

  for (const check of checks) {
    if (!check.id) continue;
    const certificate = byId.get(check.id);
    if (!certificate || certificate.environmentId !== environmentId || certificate.fileType !== check.expectedType) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Selected ${check.label} is invalid`,
      });
    }
  }
}

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

  bundleList: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      return prisma.certificateBundle.findMany({
        where: { environmentId: input.environmentId },
        orderBy: { name: "asc" },
        select: certificateBundleSelect,
      });
    }),

  bundleGet: protectedProcedure
    .input(z.object({ id: z.string(), environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const bundle = await prisma.certificateBundle.findUnique({
        where: { id: input.id },
        select: certificateBundleSelect,
      });
      if (!bundle || bundle.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Certificate bundle not found" });
      }
      return bundle;
    }),

  bundleCreate: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: certificateNameSchema,
        caId: bundleCertIdSchema,
        certId: bundleCertIdSchema,
        keyId: bundleCertIdSchema,
      }),
    )
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("certificateBundle.created", "CertificateBundle"))
    .mutation(async ({ input }) => {
      const existing = await prisma.certificateBundle.findUnique({
        where: {
          environmentId_name: {
            environmentId: input.environmentId,
            name: input.name,
          },
        },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A certificate bundle with this name already exists in this environment",
        });
      }

      await validateBundleCertificates(input.environmentId, input);

      // Resolve the parent environment's organisation so the bundle's
      // tenant column mirrors the environment join.
      const envForOrg = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { organizationId: true },
      });
      return prisma.certificateBundle.create({
        data: {
          environmentId: input.environmentId,
          organizationId: envForOrg?.organizationId ?? "default",
          name: input.name,
          caId: input.caId ?? null,
          certId: input.certId ?? null,
          keyId: input.keyId ?? null,
        },
        select: certificateBundleSelect,
      });
    }),

  bundleUpdate: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        environmentId: z.string(),
        name: certificateNameSchema,
        caId: bundleCertIdSchema,
        certId: bundleCertIdSchema,
        keyId: bundleCertIdSchema,
      }),
    )
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("certificateBundle.updated", "CertificateBundle"))
    .mutation(async ({ input }) => {
      const existing = await prisma.certificateBundle.findUnique({
        where: { id: input.id },
        select: { id: true, environmentId: true },
      });
      if (!existing || existing.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Certificate bundle not found" });
      }

      const duplicate = await prisma.certificateBundle.findUnique({
        where: {
          environmentId_name: {
            environmentId: input.environmentId,
            name: input.name,
          },
        },
        select: { id: true },
      });
      if (duplicate && duplicate.id !== input.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A certificate bundle with this name already exists in this environment",
        });
      }

      await validateBundleCertificates(input.environmentId, input);

      return prisma.certificateBundle.update({
        where: { id: input.id },
        data: {
          name: input.name,
          caId: input.caId ?? null,
          certId: input.certId ?? null,
          keyId: input.keyId ?? null,
        },
        select: certificateBundleSelect,
      });
    }),

  bundleDelete: protectedProcedure
    .input(z.object({ id: z.string(), environmentId: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("certificateBundle.deleted", "CertificateBundle"))
    .mutation(async ({ input }) => {
      const bundle = await prisma.certificateBundle.findUnique({
        where: { id: input.id },
        select: { id: true, environmentId: true },
      });
      if (!bundle || bundle.environmentId !== input.environmentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Certificate bundle not found" });
      }
      await prisma.certificateBundle.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  upload: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        name: certificateNameSchema,
        filename: z.string().min(1).max(255).regex(
          /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
          "Filename must start with a letter or number and contain only letters, numbers, dots, hyphens, and underscores",
        ),
        fileType: z.enum(["ca", "cert", "key"]),
        dataBase64: z.string().min(1),
      }),
    )
    .use(denyInDemo())
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

      const envForCertOrg = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { organizationId: true },
      });
      return prisma.certificate.create({
        data: {
          name: input.name,
          filename: input.filename,
          fileType: input.fileType,
          encryptedData: encrypt(data),
          environmentId: input.environmentId,
          organizationId: envForCertOrg?.organizationId ?? "default",
        },
        select: { id: true, name: true, filename: true, fileType: true, createdAt: true },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), environmentId: z.string() }))
    .use(denyInDemo())
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

  /**
   * Usage: returns the pipeline nodes in the certificate's environment whose
   * (decrypted) config references this certificate as `CERT[name]`.
   */
  usage: protectedProcedure
    .input(z.object({ certificateId: z.string(), environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const certificate = await prisma.certificate.findUnique({
        where: { id: input.certificateId },
        select: { id: true, name: true, environmentId: true },
      });
      if (!certificate || certificate.environmentId !== input.environmentId) {
        return {
          count: 0,
          pipelineCount: 0,
          refs: [] as Array<{
            id: string;
            componentType: string;
            pipeline: { id: string; name: string; environment: { id: string; name: string } };
          }>,
        };
      }

      const nodes = await prisma.pipelineNode.findMany({
        where: { pipeline: { environmentId: certificate.environmentId } },
        select: {
          id: true,
          componentType: true,
          config: true,
          pipeline: {
            select: {
              id: true,
              name: true,
              environment: { select: { id: true, name: true } },
            },
          },
        },
      });

      const refs = nodes
        .filter((node) => {
          const decrypted = decryptNodeConfig(
            node.componentType,
            (node.config ?? {}) as Record<string, unknown>,
          );
          return collectCertRefs(decrypted).has(certificate.name);
        })
        .map((node) => ({
          id: node.id,
          componentType: node.componentType,
          pipeline: node.pipeline,
        }));

      const pipelineCount = new Set(refs.map((ref) => ref.pipeline.id)).size;
      return { count: refs.length, pipelineCount, refs };
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
