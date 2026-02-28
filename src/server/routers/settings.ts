import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireRole } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/server/services/crypto";
import { createHash } from "crypto";

const SETTINGS_ID = "singleton";

/** Mask a secret string, showing only the last 4 characters */
function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return "****" + value.slice(-4);
}

/** Compute SSH key fingerprint (SHA-256) from raw key bytes */
function sshKeyFingerprint(keyBytes: Buffer): string {
  const hash = createHash("sha256").update(keyBytes).digest("base64");
  return `SHA256:${hash}`;
}

async function getOrCreateSettings() {
  let settings = await prisma.systemSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (!settings) {
    settings = await prisma.systemSettings.create({
      data: { id: SETTINGS_ID },
    });
  }
  return settings;
}

export const settingsRouter = router({
  get: protectedProcedure
    .use(requireRole("ADMIN"))
    .query(async () => {
      const settings = await getOrCreateSettings();

      // Decrypt clientSecret for masking
      let maskedClientSecret: string | null = null;
      if (settings.oidcClientSecret) {
        try {
          const decrypted = decrypt(settings.oidcClientSecret);
          maskedClientSecret = maskSecret(decrypted);
        } catch {
          maskedClientSecret = "****";
        }
      }

      // Compute SSH key fingerprint if present
      let sshKeyFingerPrint: string | null = null;
      if (settings.gitopsSshKey) {
        try {
          sshKeyFingerPrint = sshKeyFingerprint(Buffer.from(settings.gitopsSshKey));
        } catch {
          sshKeyFingerPrint = null;
        }
      }

      return {
        oidcIssuer: settings.oidcIssuer,
        oidcClientId: settings.oidcClientId,
        oidcClientSecret: maskedClientSecret,
        oidcDisplayName: settings.oidcDisplayName,
        oidcDefaultRole: settings.oidcDefaultRole,
        oidcGroupsClaim: settings.oidcGroupsClaim,
        oidcAdminGroups: settings.oidcAdminGroups,
        oidcEditorGroups: settings.oidcEditorGroups,
        oidcTokenEndpointAuthMethod: settings.oidcTokenEndpointAuthMethod ?? "client_secret_post",
        fleetPollIntervalMs: settings.fleetPollIntervalMs,
        fleetUnhealthyThreshold: settings.fleetUnhealthyThreshold,
        gitopsCommitAuthor: settings.gitopsCommitAuthor,
        sshKeyFingerprint: sshKeyFingerPrint,
        hasSshKey: !!settings.gitopsSshKey,
        hasHttpsToken: !!settings.gitopsHttpsToken,
        defaultDeployMode: settings.defaultDeployMode,
        updatedAt: settings.updatedAt,
      };
    }),

  updateOidc: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(
      z.object({
        issuer: z.string().url().min(1),
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
        displayName: z.string().min(1).default("SSO"),
        tokenEndpointAuthMethod: z.enum(["client_secret_post", "client_secret_basic"]).default("client_secret_post"),
      })
    )
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      const data: Record<string, unknown> = {
        oidcIssuer: input.issuer,
        oidcClientId: input.clientId,
        oidcDisplayName: input.displayName,
        oidcTokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
      };

      if (input.clientSecret !== "unchanged") {
        data.oidcClientSecret = encrypt(input.clientSecret);
      }

      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data,
      });
    }),

  updateOidcRoleMapping: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(
      z.object({
        defaultRole: z.enum(["VIEWER", "EDITOR", "ADMIN"]),
        groupsClaim: z.string().min(1).default("groups"),
        adminGroups: z.string().optional(),
        editorGroups: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          oidcDefaultRole: input.defaultRole,
          oidcGroupsClaim: input.groupsClaim,
          oidcAdminGroups: input.adminGroups || null,
          oidcEditorGroups: input.editorGroups || null,
        },
      });
    }),

  updateFleet: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(
      z.object({
        pollIntervalMs: z.number().int().min(1000).max(300000),
        unhealthyThreshold: z.number().int().min(1).max(100),
      })
    )
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          fleetPollIntervalMs: input.pollIntervalMs,
          fleetUnhealthyThreshold: input.unhealthyThreshold,
        },
      });
    }),

  updateGitops: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(
      z.object({
        commitAuthor: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          gitopsCommitAuthor: input.commitAuthor,
        },
      });
    }),

  uploadSshKey: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(
      z.object({
        keyBase64: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await getOrCreateSettings();

      const keyBuffer = Buffer.from(input.keyBase64, "base64");
      const keyText = keyBuffer.toString("utf8");

      // Validate it looks like a private key
      if (!keyText.includes("PRIVATE KEY")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This does not appear to be a private key. Please upload the private key file (not the .pub file).",
        });
      }

      const encryptedKey = encrypt(keyText);

      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          gitopsSshKey: Buffer.from(encryptedKey, "utf8"),
        },
      });
    }),

  updateGitopsHttpsToken: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await getOrCreateSettings();
      const encryptedToken = encrypt(input.token);
      return prisma.systemSettings.update({
        where: { id: SETTINGS_ID },
        data: { gitopsHttpsToken: encryptedToken },
      });
    }),

  testOidc: protectedProcedure
    .use(requireRole("ADMIN"))
    .input(
      z.object({
        issuer: z.string().url().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const discoveryUrl = `${input.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;

      try {
        const response = await fetch(discoveryUrl, {
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `OIDC discovery endpoint returned ${response.status}: ${response.statusText}`,
          });
        }

        const data = await response.json();

        if (!data.issuer || !data.authorization_endpoint || !data.token_endpoint) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "OIDC discovery response is missing required fields (issuer, authorization_endpoint, token_endpoint)",
          });
        }

        return {
          success: true,
          issuer: data.issuer,
          authorizationEndpoint: data.authorization_endpoint,
          tokenEndpoint: data.token_endpoint,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to connect to OIDC provider: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),
});
