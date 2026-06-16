import crypto from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess, requirePlatformOperator, denyInDemo } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withOrgTx } from "@/lib/with-org-tx";
import { withAudit } from "@/server/middleware/audit";
import { generateEnrollmentToken } from "@/server/services/agent-token";
import { DEFAULT_ORG_ID, DEFAULT_ORG_SLUG } from "@/lib/org-constants";
import { encrypt, decrypt, ENCRYPTION_DOMAINS } from "@/server/services/crypto";
import {
  encryptForOrgOrFallback,
  decryptForOrgOrFallback,
  loadOrgDataKeyCiphertext,
} from "@/server/services/crypto-v3-callsite";
import { testVaultConnection as testVaultClientConnection, listVaultFields, type VaultBackendConfig } from "@/server/services/vault-client";
import { enforceQuota } from "@/server/services/quotas-trpc";
import {
  LAKE_BUCKET_PROVIDERS,
  coldTierIsSearchable,
  encryptBucketCredential,
  syncDatasetTieringForEnvironment,
} from "@/server/services/lake/byo-bucket";
import {
  getEnvRetention,
  setEnvRetention,
  clearEnvRetention,
  InvalidRetentionError,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
} from "@/server/services/lake/lake-retention-policy";


const VAULT_AUTH_METHODS = ["token", "approle", "kubernetes"] as const;

function hasNoVaultDotSegments(path: string): boolean {
  return path.trim().split("/").filter(Boolean).every((segment) => segment !== "." && segment !== "..");
}


const vaultConfigSchema = z.object({
  address: z.string().trim().url("Vault address must be a valid URL").refine((value) => new URL(value).protocol === "https:", "Vault address must use HTTPS"),
  authMethod: z.enum(VAULT_AUTH_METHODS),
  mountPath: z.string().trim().min(1, "Vault mount path is required").refine(hasNoVaultDotSegments, "Vault paths cannot contain . or .. segments"),
  basePath: z.string().trim().optional().refine((value) => !value || hasNoVaultDotSegments(value), "Vault paths cannot contain . or .. segments"),
  namespace: z.string().trim().optional(),
  token: z.string().optional(),
  roleId: z.string().trim().optional(),
  secretId: z.string().optional(),
  role: z.string().trim().optional(),
});


function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeVaultConfigForClient(config: unknown): Record<string, unknown> | null {
  if (!isRecord(config)) return null;
  const safe = { ...config };
  delete safe.token;
  delete safe.secretId;
  delete safe.jwt;
  delete safe.jwtPath;
  return {
    ...safe,
    ...(typeof config.basePath === "string" && config.basePath.trim() ? { basePath: config.basePath.trim() } : {}),
    ...(typeof config.token === "string" && config.token.length > 0 ? { hasToken: true } : {}),
    ...(typeof config.secretId === "string" && config.secretId.length > 0 ? { hasSecretId: true } : {}),
  };
}

function prepareVaultConfigForStorage(inputConfig: unknown, existingConfig: unknown): VaultBackendConfig {
  const parsed = vaultConfigSchema.parse(inputConfig);
  const existing = isRecord(existingConfig) ? existingConfig : {};
  const config: VaultBackendConfig = {
    address: parsed.address,
    authMethod: parsed.authMethod,
    mountPath: parsed.mountPath,
    ...(nonEmpty(parsed.basePath) ? { basePath: nonEmpty(parsed.basePath) } : {}),
    ...(parsed.namespace ? { namespace: parsed.namespace } : {}),
  };

  if (parsed.authMethod === "token") {
    const token = nonEmpty(parsed.token);
    const storedToken = nonEmpty(existing.token);
    if (!token && !storedToken) throw new TRPCError({ code: "BAD_REQUEST", message: "Vault token is required" });
    config.token = token ? encrypt(token) : storedToken;
  }

  if (parsed.authMethod === "approle") {
    const secretId = nonEmpty(parsed.secretId);
    const storedSecretId = nonEmpty(existing.secretId);
    if (!parsed.roleId) throw new TRPCError({ code: "BAD_REQUEST", message: "Vault AppRole role_id is required" });
    if (!secretId && !storedSecretId) throw new TRPCError({ code: "BAD_REQUEST", message: "Vault AppRole secret_id is required" });
    config.roleId = parsed.roleId;
    if (parsed.role) config.role = parsed.role;
    config.secretId = secretId ? encrypt(secretId) : storedSecretId;
  }

  if (parsed.authMethod === "kubernetes") {
    if (!parsed.role) throw new TRPCError({ code: "BAD_REQUEST", message: "Vault role is required" });
    config.role = parsed.role;
  }

  return config;
}

function prepareVaultConfigForConnection(inputConfig: unknown, existingConfig?: unknown): VaultBackendConfig {
  const parsed = vaultConfigSchema.parse(inputConfig);
  const existing = isRecord(existingConfig) ? existingConfig : {};
  const storedToken = nonEmpty(existing.token);
  const storedSecretId = nonEmpty(existing.secretId);
  const token = nonEmpty(parsed.token);
  const secretId = nonEmpty(parsed.secretId);

  return {
    address: parsed.address,
    authMethod: parsed.authMethod,
    mountPath: parsed.mountPath,
    ...(nonEmpty(parsed.basePath) ? { basePath: nonEmpty(parsed.basePath) } : nonEmpty(existing.basePath) ? { basePath: nonEmpty(existing.basePath) } : {}),
    ...(parsed.namespace ? { namespace: parsed.namespace } : {}),
    ...(token ? { token } : storedToken ? { token: decrypt(storedToken) } : {}),
    ...(parsed.roleId ? { roleId: parsed.roleId } : nonEmpty(existing.roleId) ? { roleId: nonEmpty(existing.roleId) } : {}),
    ...(secretId ? { secretId } : storedSecretId ? { secretId: decrypt(storedSecretId) } : {}),
    ...(parsed.role ? { role: parsed.role } : nonEmpty(existing.role) ? { role: nonEmpty(existing.role) } : {}),
  };
}
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
          secretBackend: true,
          createdAt: true,
          gitOpsMode: true,
          gitRepoUrl: true,
          _count: {
            select: {
              nodes: true,
              pipelines: true,
              gitSyncJobs: { where: { status: "failed" } },
              alertRules: true,
            },
          },
          pipelines: {
            select: { deployedAt: true },
            where: { deployedAt: { not: null } },
            orderBy: { deployedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  /** Returns the system environment for super admins */
  getSystem: protectedProcedure
    .use(requirePlatformOperator())
    .query(async () => {
      const env = await prisma.environment.findFirst({
        where: { isSystem: true },
        select: { id: true, name: true, isSystem: true },
      });
      return env;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(withTeamAccess("VIEWER"))
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

      const { gitToken, enrollmentTokenHash, gitWebhookSecret: encryptedWebhookSecret, ...safe } = environment;
      return {
        ...safe,
        secretBackendConfig: sanitizeVaultConfigForClient(safe.secretBackendConfig),
        hasEnrollmentToken: !!enrollmentTokenHash,
        hasGitToken: !!gitToken,
        hasWebhookSecret: !!encryptedWebhookSecret,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        teamId: z.string(),
      })
    )
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("environment.created", "Environment"))
    .mutation(async ({ input }) => {
      // Verify team exists and capture its organization so the quota gate
      // counts against the right tenant (one Org owns N Teams; quotas are
      // per-Org).
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { id: true, organizationId: true },
      });
      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team not found",
        });
      }

      // Per-org plan-tier quota gate. Throws PAYMENT_REQUIRED with the
      // QuotaExceededError as `cause` when the FREE/PRO `environments` limit
      // is reached.
      return enforceQuota(team.organizationId, "environments", (tx) =>
        tx.environment.create({
          data: {
            name: input.name,
            teamId: input.teamId,
            // Write the org id on the row so the quota post-check
            // (which counts by `organizationId`) actually sees it. Without
            // this the column defaults to "default" and non-default tenants
            // could bypass the cap indefinitely.
            organizationId: team.organizationId,
          },
        }),
      );
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
        gitOpsMode: z.enum(["off", "push", "bidirectional", "promotion"]).optional(),
        gitProvider: z.enum(["github", "gitlab", "bitbucket"]).nullable().optional(),
        requireDeployApproval: z.boolean().optional(),
        costPerGbCents: z.number().int().min(0).max(100_000).optional(), // cents per GB, max $1000/GB
        costBudgetCents: z.number().int().min(0).max(1_000_000_00).nullable().optional(), // monthly budget in cents, null to disable
        volumeBudgetGb: z.number().int().min(0).max(100_000_000).nullable().optional(), // monthly volume budget in GB, null to disable
      })
    )
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("environment.updated", "Environment"))
    .mutation(async ({ input, ctx }) => {
      const { id, gitToken, gitProvider, requireDeployApproval, ...rest } = input;

      // Only ADMINs can toggle the approval requirement
      const userRole = (ctx as Record<string, unknown>).userRole as string;
      if (requireDeployApproval !== undefined && userRole === "EDITOR") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can change the deploy approval requirement",
        });
      }

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
      const { gitOpsMode: gitOpsModeInput, secretBackendConfig, secretBackend, ...restWithoutGitOps } = rest;
      const data: Record<string, unknown> = { ...restWithoutGitOps };
      if (secretBackend !== undefined) {
        data.secretBackend = secretBackend;
      }
      if (secretBackend === "VAULT" || (secretBackend === undefined && existing.secretBackend === "VAULT" && secretBackendConfig !== undefined)) {
        data.secretBackendConfig = prepareVaultConfigForStorage(secretBackendConfig, existing.secretBackendConfig);
      } else if (secretBackend !== undefined) {
        data.secretBackendConfig = secretBackend === "BUILTIN" ? null : (secretBackendConfig ?? null);
      } else if (secretBackendConfig !== undefined) {
        data.secretBackendConfig = secretBackendConfig;
      }
      if (requireDeployApproval !== undefined) {
        data.requireDeployApproval = requireDeployApproval;
      }
      if (gitToken !== undefined) {
        if (gitToken === null || gitToken === "") {
          data.gitToken = null;
        } else {
          // PR 9-B — wrap through v3-or-v2. Same `GENERIC` HKDF domain
          // as the legacy v2 path keeps historical ciphertexts readable.
          const dataKeyCiphertext = await loadOrgDataKeyCiphertext(existing.organizationId);
          data.gitToken = await encryptForOrgOrFallback(gitToken, {
            orgId: existing.organizationId,
            dataKeyCiphertext,
            domain: ENCRYPTION_DOMAINS.GENERIC,
            rowTable: "Environment",
            rowId: existing.id,
          });
        }
      }
      if (gitProvider !== undefined) {
        data.gitProvider = gitProvider;
      }

      // Handle gitOpsMode — auto-generate webhook secret when switching to bidirectional or promotion
      let plaintextWebhookSecret: string | null = null;
      if (gitOpsModeInput !== undefined) {
        data.gitOpsMode = gitOpsModeInput;

        const needsWebhookSecret = gitOpsModeInput === "bidirectional" || gitOpsModeInput === "promotion";
        if (needsWebhookSecret && !existing.gitWebhookSecret) {
          plaintextWebhookSecret = crypto.randomBytes(32).toString("hex");
          data.gitWebhookSecret = encrypt(plaintextWebhookSecret);
        }
        // Clear webhook secret when disabling webhook-based modes
        if (!needsWebhookSecret) {
          data.gitWebhookSecret = null;
        }
      }

      const updated = await prisma.environment.update({
        where: { id },
        data,
      });
      const { gitToken: _gt, enrollmentTokenHash: _eth, gitWebhookSecret: _gws, ...safeUpdate } = updated;

      // Only return the plaintext webhook secret when freshly generated;
      // never decrypt and return the stored secret on unrelated updates.
      return {
        ...safeUpdate,
        secretBackendConfig: sanitizeVaultConfigForClient(safeUpdate.secretBackendConfig),
        hasEnrollmentToken: !!_eth,
        hasGitToken: !!_gt,
        hasWebhookSecret: !!_gws,
        gitWebhookSecret: plaintextWebhookSecret,
      };
    }),

  testVaultConnection: protectedProcedure
    .input(z.object({
      environmentId: z.string(),
      config: vaultConfigSchema,
      testSecretPath: z.string().trim().refine((value) => !value || hasNoVaultDotSegments(value), "Vault paths cannot contain . or .. segments").optional(),
    }))
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("environment.vaultConnection.tested", "Environment"))
    .mutation(async ({ input }) => {
      const parsed = vaultConfigSchema.parse(input.config);
      const needsStoredCredential =
        (parsed.authMethod === "token" && !nonEmpty(parsed.token)) ||
        (parsed.authMethod === "approle" && (!nonEmpty(parsed.secretId) || !parsed.roleId));
      const existing = needsStoredCredential
        ? await prisma.environment.findUnique({
            where: { id: input.environmentId },
            select: { secretBackendConfig: true },
          })
        : null;

      return testVaultClientConnection(
        prepareVaultConfigForConnection(input.config, existing?.secretBackendConfig),
        input.testSecretPath,
      );
    }),
  listVaultSecrets: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const environment = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: {
          secretBackend: true,
          secretBackendConfig: true,
        },
      });
      if (!environment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      if (environment.secretBackend !== "VAULT") {
        return {
          backend: environment.secretBackend,
          secrets: [],
        };
      }

      const config = prepareVaultConfigForConnection(
        isRecord(environment.secretBackendConfig)
          ? { ...environment.secretBackendConfig, token: "", secretId: "" }
          : environment.secretBackendConfig,
        environment.secretBackendConfig,
      );
      const basePath = nonEmpty(config.basePath);
      if (!basePath) {
        return {
          backend: environment.secretBackend,
          secrets: [],
        };
      }

      return {
        backend: environment.secretBackend,
        secrets: await listVaultFields(config, basePath),
      };
    }),

  testGitConnection: protectedProcedure
    .input(z.object({
      environmentId: z.string(),
      repoUrl: z.string().url(),
      branch: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._\/-]+$/),
      token: z.string().min(1).optional(),
    }))
    .use(denyInDemo())
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("environment.gitConnection.tested", "Environment"))
    .mutation(async ({ input }) => {
      // Resolve token: use provided token, or fall back to stored encrypted token
      let resolvedToken = input.token;
      if (!resolvedToken) {
        const env = await prisma.environment.findUnique({
          where: { id: input.environmentId },
          select: { id: true, organizationId: true, gitToken: true },
        });
        if (!env?.gitToken) {
          return { success: false, error: "No access token configured" };
        }
        const dataKeyCiphertext = await loadOrgDataKeyCiphertext(env.organizationId);
        resolvedToken = await decryptForOrgOrFallback(env.gitToken, {
          orgId: env.organizationId,
          dataKeyCiphertext,
          domain: ENCRYPTION_DOMAINS.GENERIC,
          rowTable: "Environment",
          rowId: env.id,
        });
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
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.deleted", "Environment"))
    .mutation(async ({ input, ctx }) => {
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
      return withOrgTx(ctx.organizationId, async (tx) => [
        // PipelineVersion lacks onDelete: Cascade, clean up explicitly
        await tx.pipelineVersion.deleteMany({ where: { pipelineId: { in: pipelineIds } } }),
        await tx.pipeline.deleteMany({ where: { environmentId: input.id } }),
        await tx.vectorNode.deleteMany({ where: { environmentId: input.id } }),
        await tx.environment.delete({ where: { id: input.id } }),
      ]);
    }),

  generateEnrollmentToken: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.enrollmentToken.generated", "Environment"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }
      // Derive the org slug for the token prefix from the environment's owning org.
      // Short-circuit for OSS (DEFAULT_ORG_ID) — the row is always present and we
      // avoid an unnecessary lookup. For real multi-tenant orgs, fail loudly if
      // the row is missing or soft-deleted rather than silently minting a
      // default-scoped token.
      let orgSlug: string;
      if (env.organizationId === DEFAULT_ORG_ID) {
        orgSlug = DEFAULT_ORG_SLUG;
      } else {
        const org = await prisma.organization.findUnique({
          where: { id: env.organizationId },
          select: { slug: true, deletedAt: true },
        });
        if (!org || org.deletedAt) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Environment's organization not found or deleted — cannot mint enrollment token",
          });
        }
        orgSlug = org.slug;
      }
      const { token, hash, hint, identifier } = await generateEnrollmentToken(orgSlug);
      await prisma.environment.update({
        where: { id: input.environmentId },
        data: {
          enrollmentTokenHash: hash,
          enrollmentTokenHint: hint,
          enrollmentTokenId: identifier,
        },
      });

      return { token, hint };
    }),

  revokeEnrollmentToken: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(denyInDemo())
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
          enrollmentTokenId: null,
        },
      });

      return { success: true };
    }),

  /**
   * Read an environment's BYO lake cold-tier bucket config. Returns the
   * non-secret descriptor plus credential presence only — never the encrypted
   * or decrypted credentials. `null` when the environment uses the VF-managed
   * cold tier.
   */
  getLakeBucket: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const bucket = await prisma.environmentLakeBucket.findUnique({
        where: { environmentId: input.environmentId },
        select: {
          provider: true,
          bucket: true,
          region: true,
          endpoint: true,
          prefix: true,
          encryptedAccessKeyId: true,
          encryptedSecretAccessKey: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!bucket) return null;

      const provider = bucket.provider as (typeof LAKE_BUCKET_PROVIDERS)[number];
      // Strip the ciphertext columns; expose only presence so the form can show
      // "configured" without ever shipping a credential to the client.
      const { encryptedAccessKeyId, encryptedSecretAccessKey, ...safe } = bucket;
      return {
        ...safe,
        provider,
        hasAccessKeyId: !!encryptedAccessKeyId,
        hasSecretAccessKey: !!encryptedSecretAccessKey,
        // false → cold-only (no in-place lake search); drives the degraded
        // -search notice in the search UI.
        searchable: coldTierIsSearchable(provider),
      };
    }),

  /**
   * Configure (upsert) the environment's BYO lake cold-tier bucket. Credentials
   * are encrypted at rest (crypto-v3 with v2 fallback) before persisting. An
   * external-only provider (gcs/azure) demotes the env's datasets to
   * `tiering = 'external'` so in-place search is disabled for them.
   */
  setLakeBucket: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        provider: z.enum(LAKE_BUCKET_PROVIDERS),
        bucket: z.string().trim().min(1).max(255),
        region: z.string().trim().max(64).nullish(),
        endpoint: z.string().trim().max(255).nullish(),
        prefix: z.string().trim().max(255).nullish(),
        // Write-only credentials. `undefined` keeps the stored value; `null` or
        // "" clears it; a non-empty string is encrypted and replaces it.
        accessKeyId: z.string().max(512).nullish(),
        secretAccessKey: z.string().max(4096).nullish(),
      }),
    )
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.lake_bucket_set", "Environment"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { organizationId: true, isSystem: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }
      if (env.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The system environment cannot have a lake bucket",
        });
      }
      const orgId = env.organizationId;
      const scope = { orgId, environmentId: input.environmentId };

      // Resolve each credential to: undefined (keep), null (clear), or an
      // encrypted ciphertext. Encryption happens before any DB write.
      let encAccessKeyId: string | null | undefined;
      if (input.accessKeyId === undefined) {
        encAccessKeyId = undefined;
      } else if (input.accessKeyId === null || input.accessKeyId.trim() === "") {
        encAccessKeyId = null;
      } else {
        encAccessKeyId = await encryptBucketCredential(input.accessKeyId.trim(), scope);
      }

      let encSecretAccessKey: string | null | undefined;
      if (input.secretAccessKey === undefined) {
        encSecretAccessKey = undefined;
      } else if (input.secretAccessKey === null || input.secretAccessKey.trim() === "") {
        encSecretAccessKey = null;
      } else {
        encSecretAccessKey = await encryptBucketCredential(input.secretAccessKey.trim(), scope);
      }

      const config = {
        provider: input.provider,
        bucket: input.bucket,
        region: input.region ?? null,
        endpoint: input.endpoint ?? null,
        prefix: input.prefix ?? null,
      };

      return withOrgTx(orgId, async (tx) => {
        await tx.environmentLakeBucket.upsert({
          where: { environmentId: input.environmentId },
          create: {
            organizationId: orgId,
            environmentId: input.environmentId,
            ...config,
            encryptedAccessKeyId: encAccessKeyId ?? null,
            encryptedSecretAccessKey: encSecretAccessKey ?? null,
          },
          update: {
            ...config,
            ...(encAccessKeyId !== undefined ? { encryptedAccessKeyId: encAccessKeyId } : {}),
            ...(encSecretAccessKey !== undefined ? { encryptedSecretAccessKey: encSecretAccessKey } : {}),
          },
        });
        const { searchable } = await syncDatasetTieringForEnvironment(tx, {
          orgId,
          environmentId: input.environmentId,
        });
        return { success: true, provider: input.provider, searchable };
      });
    }),

  /**
   * Remove the environment's BYO lake cold-tier bucket, reverting it to the
   * VF-managed (searchable) cold tier. Any datasets previously demoted to
   * `external` are restored to `cold`.
   */
  clearLakeBucket: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.lake_bucket_cleared", "Environment"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { organizationId: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }
      const orgId = env.organizationId;

      return withOrgTx(orgId, async (tx) => {
        // deleteMany (not delete) so clearing an absent bucket is idempotent.
        await tx.environmentLakeBucket.deleteMany({
          where: { environmentId: input.environmentId },
        });
        const { searchable } = await syncDatasetTieringForEnvironment(tx, {
          orgId,
          environmentId: input.environmentId,
        });
        return { success: true, searchable };
      });
    }),

  /**
   * Read an environment's effective lake retention window. Returns the dedicated
   * per-env policy when one is set, otherwise the table defaults
   * (`isDefault: true`). `bounds` lets the form constrain its inputs.
   */
  getLakeRetention: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { organizationId: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }
      const retention = await getEnvRetention(prisma, {
        orgId: env.organizationId,
        environmentId: input.environmentId,
      });
      return {
        ...retention,
        bounds: { min: MIN_RETENTION_DAYS, max: MAX_RETENTION_DAYS },
      };
    }),

  /**
   * Set the environment's lake retention window. Upserts the dedicated per-env
   * `LakeRetentionPolicy` and attaches every dataset in the environment; the
   * daily sweep then enforces `coldDays` as the per-dataset delete horizon.
   * `hotDays` governs the hot→cold move and is stored for the shared table TTL.
   */
  setLakeRetention: protectedProcedure
    .input(
      z.object({
        environmentId: z.string(),
        hotDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS),
        coldDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS),
      }),
    )
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.lake_retention_set", "Environment"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { organizationId: true, isSystem: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }
      if (env.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The system environment cannot have a lake retention policy",
        });
      }
      const orgId = env.organizationId;

      try {
        return await withOrgTx(orgId, (tx) =>
          setEnvRetention(tx, {
            orgId,
            environmentId: input.environmentId,
            hotDays: input.hotDays,
            coldDays: input.coldDays,
          }).then(({ attached }) => ({ success: true, attached })),
        );
      } catch (err) {
        if (err instanceof InvalidRetentionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Clear the environment's lake retention policy, reverting its datasets to the
   * table defaults. Idempotent.
   */
  clearLakeRetention: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .use(denyInDemo())
    .use(withTeamAccess("ADMIN"))
    .use(withAudit("environment.lake_retention_cleared", "Environment"))
    .mutation(async ({ input }) => {
      const env = await prisma.environment.findUnique({
        where: { id: input.environmentId },
        select: { organizationId: true },
      });
      if (!env) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
      }
      const orgId = env.organizationId;

      return withOrgTx(orgId, (tx) =>
        clearEnvRetention(tx, {
          orgId,
          environmentId: input.environmentId,
        }).then(({ cleared, detached }) => ({ success: true, cleared, detached })),
      );
    }),
});
