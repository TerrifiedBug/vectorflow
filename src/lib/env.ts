import { z } from "zod";

const logLevelSchema = z.enum(["debug", "trace", "info", "warn", "error"]);
type LogLevel = z.infer<typeof logLevelSchema>;

// During `next build`, server-side modules are statically analyzed without real
// env vars. Skip strict validation in that phase so the build completes.
// At runtime the required vars ARE present and validation will catch misconfig.
export const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.NEXT_PHASE === "phase-export";

// Placeholder secrets shipped in docker/server/.env.example. If a production
// deployment is still running with one of these literal values, the operator
// never replaced the example value — every "secret" is publicly known. Reject
// at boot rather than silently serving with a known session/encryption key.
// Matches the published `change-me-...` examples (case-insensitive) so a
// trivially-edited variant like `Change-Me-...` is still caught.
const PLACEHOLDER_SECRET_PATTERN = /^change-me-/i;

export function isPlaceholderSecret(value: string | undefined): boolean {
  return typeof value === "string" && PLACEHOLDER_SECRET_PATTERN.test(value);
}

const runtimeEnvSchema = z
  .object({
    DATABASE_URL: isBuildPhase
      ? z.string().optional().default("build-placeholder")
      : z.string().min(1, "DATABASE_URL is required"),
    // Admin / owner connection used ONLY for legitimate pre-context and
    // cross-org work (credential→org resolution before a tenancy scope
    // exists, operator/platform reads, migrations). In multi-tenant cloud
    // this points at the table-owner (BYPASSRLS) role while DATABASE_URL
    // points at the fenced `vectorflow_app` (NOBYPASSRLS) role. Unset in
    // OSS — the app falls back to DATABASE_URL, which already bypasses RLS
    // as the table owner, so behaviour is unchanged.
    DATABASE_ADMIN_URL: z.string().optional(),
    NEXTAUTH_SECRET: isBuildPhase
      ? z.string().optional().default("build-placeholder-secret-min-16-chars")
      : z.string().min(16, "NEXTAUTH_SECRET must be at least 16 characters"),
    NEXTAUTH_URL: isBuildPhase
      ? z.string().optional().default("http://localhost:3000")
      : z.string().url("NEXTAUTH_URL must be a valid URL").optional(),
    AUTH_TRUST_HOST: z.string().optional(),

    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    VF_LOG_LEVEL: logLevelSchema.optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(50),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    VF_BACKUP_DIR: z.string().default("/backups"),
    VF_VECTOR_BIN: z.string().default("vector"),
    VF_SYSTEM_CONFIG_PATH: z.string().default("/etc/vectorflow/system-vector.yaml"),
    VF_AUDIT_LOG_PATH: z.string().optional(),
    // Accepts missing/empty/anything; only the literal "true" enables demo mode.
    // Lenient because Next.js build-args may pass "" when the ARG is unset.
    NEXT_PUBLIC_VF_DEMO_MODE: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    VF_VERSION: z.string().default("dev"),
    METRICS_CHUNK_INTERVAL: z.string().default("1 day"),
    METRICS_COMPRESS_AFTER: z.string().default("24 hours"),
    PORT: z.coerce.number().int().default(3000),

    // SLO gate for canary broadening (IF-7): the aggregate canary error ratio
    // (0..1) above which `broadenRollout` refuses to advance the canary and
    // holds it in HEALTH_CHECK with a recorded reason. Conservative — only a
    // clearly-burned budget blocks; this never triggers an auto-rollback.
    VF_ROLLOUT_ERROR_BUDGET: z.coerce.number().min(0).max(1).default(0.05),

    VF_DISABLE_LOCAL_AUTH: z.string().optional(),
    DEV_AUTH_BYPASS: z.string().optional(),
    DEV_AUTH_BYPASS_ALLOW_NETWORK: z.string().optional(),
    DEV_AUTH_BYPASS_USER_ID: z.string().optional(),
    DEV_AUTH_BYPASS_USER_EMAIL: z.string().optional(),
    DEV_AUTH_BYPASS_USER_NAME: z.string().optional(),
    TIMESCALEDB_ENABLED: z.string().optional(),
    VF_ENCRYPTION_KEY_V2: z.string().optional(),
    // Explicit operator acknowledgement that the encryption-at-rest master key
    // may be derived from NEXTAUTH_SECRET (i.e. VF_ENCRYPTION_KEY_V2 is unset).
    // Only the literal "true" opts in; see the production boot guard below.
    VF_ALLOW_NEXTAUTH_DERIVED_KEY: z.string().optional(),
    // GA gate for the RLS rollout. When "true", the boot probe
    // (`assertRlsEnforcementBoot`) refuses to start unless the DB role is
    // NOBYPASSRLS and the `app.org_id` policy actually fires. Read directly
    // from `process.env` in the boot probe; declared here so the contract
    // is validated and documented in one place.
    VF_ENFORCE_RLS: z.string().optional(),
    SENTRY_AUTH_TOKEN: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    REDIS_URL: z.string().optional(),
    CONTEXT7_API_KEY: z.string().optional(),
    ANALYZE: z.string().optional(),
    NEXT_RUNTIME: z.string().optional(),
    LOG_LEVEL: z.string().optional(),

    // ── VectorFlow Lake (ClickHouse) ──────────────────────────────────────
    // Optional long-retention event store (A1). All vars are OPTIONAL: when
    // VF_LAKE_CLICKHOUSE_URL is unset the lake is fully inert — `isLakeEnabled()`
    // is false and nothing ever connects (see
    // src/server/services/lake/clickhouse.ts). Non-lake deployments (the
    // default) are completely unaffected.
    VF_LAKE_CLICKHOUSE_URL: z.string().optional(),
    VF_LAKE_CLICKHOUSE_USER: z.string().optional(),
    VF_LAKE_CLICKHOUSE_PASSWORD: z.string().optional(),
    // Default DB mirrors DEFAULT_LAKE_DATABASE in the lake wrapper.
    VF_LAKE_CLICKHOUSE_DATABASE: z.string().default("vectorflow_lake"),
    // Connection-pool bounds for the lake ClickHouse client. createClient()
    // otherwise opens unbounded sockets under load (the @clickhouse/client pool
    // is per-client and we keep a single cached client). Cap concurrent sockets
    // and fail slow requests rather than hang. Conservative defaults — raise
    // VF_LAKE_CH_POOL_MAX for higher lake query/insert parallelism.
    VF_LAKE_CH_POOL_MAX: z.coerce.number().int().positive().default(10),
    VF_LAKE_CH_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(30000),
    // Cold tier (S3-backed). When VF_LAKE_S3_BUCKET is set the lake migration
    // runner (scripts/lake-migrate.ts) applies a TTL move-to-cold +
    // `storage_policy='vf_hot_cold'`; otherwise lake_events is a plain MergeTree
    // with a TTL-delete only, so it runs on a vanilla ClickHouse.
    VF_LAKE_S3_ENDPOINT: z.string().optional(),
    VF_LAKE_S3_BUCKET: z.string().optional(),
    VF_LAKE_S3_REGION: z.string().optional(),
    VF_LAKE_S3_ACCESS_KEY_ID: z.string().optional(),
    VF_LAKE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (isBuildPhase || value.NEXTAUTH_URL || value.AUTH_TRUST_HOST === "true") {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["NEXTAUTH_URL"],
      message: "NEXTAUTH_URL is required unless AUTH_TRUST_HOST=true",
    });
  });

export type Env = Omit<z.infer<typeof runtimeEnvSchema>, "VF_LOG_LEVEL"> & { VF_LOG_LEVEL: LogLevel };

function validateEnv(): Env {
  const inheritedLogLevel = process.env.VF_LOG_LEVEL ?? process.env.LOG_LEVEL;
  const result = runtimeEnvSchema.safeParse({
    ...process.env,
    ...(inheritedLogLevel ? { VF_LOG_LEVEL: inheritedLogLevel } : {}),
  });
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Environment validation failed:\n${formatted}\n\nCheck your .env file or environment variables.`
    );
  }
  // Hard-fail in production if a published placeholder secret was never
  // replaced. docker/server/.env.example ships `change-me-...` defaults for
  // NEXTAUTH_SECRET (and the optional VF_ENCRYPTION_KEY_V2); booting with them
  // means the session-signing and encryption-at-rest keys are publicly known,
  // so any attacker can forge sessions and decrypt stored secrets. Refuse to
  // boot rather than serve traffic on a known key. Dev/test keep using example
  // values freely, so this only fires when NODE_ENV=production.
  if (!isBuildPhase && result.data.NODE_ENV === "production") {
    const placeholderVars: string[] = [];
    if (isPlaceholderSecret(result.data.NEXTAUTH_SECRET)) {
      placeholderVars.push("NEXTAUTH_SECRET");
    }
    if (isPlaceholderSecret(result.data.VF_ENCRYPTION_KEY_V2)) {
      placeholderVars.push("VF_ENCRYPTION_KEY_V2");
    }
    if (placeholderVars.length > 0) {
      throw new Error(
        `Environment validation failed:\n` +
          placeholderVars
            .map(
              (name) =>
                `  - ${name}: still set to the published "change-me-..." placeholder from .env.example`,
            )
            .join("\n") +
          `\n\nReplace these with unique random values before running in production. ` +
          `Generate one with: openssl rand -base64 32`,
      );
    }
  }

  // Encryption-at-rest root. Without a dedicated key, the master key is derived
  // from NEXTAUTH_SECRET, coupling secret-at-rest to the session-signing secret:
  // rotating NEXTAUTH_SECRET would then make every encrypted secret (DB creds,
  // OIDC/git/AI keys, TOTP) permanently undecryptable — a silent, irreversible
  // footgun. In production, refuse to boot unless the operator either set a
  // dedicated VF_ENCRYPTION_KEY_V2 or explicitly accepted the coupling via
  // VF_ALLOW_NEXTAUTH_DERIVED_KEY=true. Existing deployments holding data
  // encrypted under the NEXTAUTH_SECRET-derived key migrate losslessly by
  // setting VF_ENCRYPTION_KEY_V2 to their current NEXTAUTH_SECRET value.
  if (
    !isBuildPhase &&
    result.data.NODE_ENV === "production" &&
    !result.data.VF_ENCRYPTION_KEY_V2
  ) {
    if (result.data.VF_ALLOW_NEXTAUTH_DERIVED_KEY !== "true") {
      throw new Error(
        "Environment validation failed:\n" +
          "  - VF_ENCRYPTION_KEY_V2: not set in production.\n\n" +
          "Without it, the encryption-at-rest master key is derived from " +
          "NEXTAUTH_SECRET, so rotating NEXTAUTH_SECRET makes every encrypted " +
          "secret (DB credentials, OIDC/git/AI keys, TOTP) permanently " +
          "unrecoverable. Choose one before booting in production:\n" +
          "  - New deployment: set VF_ENCRYPTION_KEY_V2 to a dedicated random " +
          "value (openssl rand -base64 32).\n" +
          "  - Existing deployment with data already encrypted under the " +
          "NEXTAUTH_SECRET-derived key: set VF_ENCRYPTION_KEY_V2 to your CURRENT " +
          "NEXTAUTH_SECRET value to migrate without data loss, after which " +
          "NEXTAUTH_SECRET can be rotated safely.\n" +
          "  - To intentionally keep deriving the key from NEXTAUTH_SECRET (and " +
          "never rotate it), set VF_ALLOW_NEXTAUTH_DERIVED_KEY=true.",
      );
    }
    // Boot-time warning emitted before the structured logger is wired. The
    // operator opted in, so the coupling stays loud but non-fatal.
    console.warn(
      "[vectorflow] VF_ENCRYPTION_KEY_V2 is unset and " +
        "VF_ALLOW_NEXTAUTH_DERIVED_KEY=true: the encryption-at-rest master key is " +
        "derived from NEXTAUTH_SECRET. Do NOT rotate NEXTAUTH_SECRET or all " +
        "encrypted secrets (DB creds, OIDC/git/AI keys, TOTP) become unrecoverable."
    );
  }

  return {
    ...result.data,
    VF_LOG_LEVEL: result.data.VF_LOG_LEVEL ?? "info",
  };
}

export const env = validateEnv();
