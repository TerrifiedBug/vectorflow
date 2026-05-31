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
    SENTRY_AUTH_TOKEN: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    REDIS_URL: z.string().optional(),
    CONTEXT7_API_KEY: z.string().optional(),
    ANALYZE: z.string().optional(),
    NEXT_RUNTIME: z.string().optional(),
    LOG_LEVEL: z.string().optional(),
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
