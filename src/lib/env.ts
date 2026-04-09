import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_SECRET: z.string().min(16, "NEXTAUTH_SECRET must be at least 16 characters"),
  NEXTAUTH_URL: z.string().url("NEXTAUTH_URL must be a valid URL"),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  VF_LOG_LEVEL: z.enum(["debug", "trace", "info", "warn", "error"]).default("info"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(50),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  VF_BACKUP_DIR: z.string().default("/backups"),
  VF_VECTOR_BIN: z.string().default("vector"),
  VF_SYSTEM_CONFIG_PATH: z.string().default("/etc/vectorflow/system-vector.yaml"),
  VF_AUDIT_LOG_PATH: z.string().optional(),
  VF_VERSION: z.string().default("dev"),
  METRICS_CHUNK_INTERVAL: z.string().default("1 day"),
  METRICS_COMPRESS_AFTER: z.string().default("24 hours"),
  PORT: z.coerce.number().int().default(3000),

  VF_DISABLE_LOCAL_AUTH: z.string().optional(),
  TIMESCALEDB_ENABLED: z.string().optional(),
  VF_ENCRYPTION_KEY_V2: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  REDIS_URL: z.string().optional(),
  CONTEXT7_API_KEY: z.string().optional(),
  ANALYZE: z.string().optional(),
  NEXT_RUNTIME: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Environment validation failed:\n${formatted}\n\nCheck your .env file or environment variables.`
    );
  }
  return result.data;
}

export const env = validateEnv();
