import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  _tsdbDetected?: boolean;
};

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,

    // Pool size: sized for production fleet scale (100+ pipelines, 5+ nodes).
    // Override via DATABASE_POOL_MAX for workloads with different parallelism needs.
    max: env.DATABASE_POOL_MAX,

    // Fail fast on pool exhaustion instead of waiting indefinitely (pg default: 0 = no timeout).
    // 5 s is long enough for a healthy pool to recycle a connection but short enough to
    // surface saturation issues quickly in logs and error responses.
    connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,

    // Keep idle connections warm for 30 s (pg default: 10 s).
    // Matches the typical heartbeat burst interval so connections survive between bursts
    // without accumulating stale handles.
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
  });
  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

import { detectTimescaleDb } from "@/server/services/timescaledb";

// Detect TimescaleDB availability on first import.
// Non-blocking — logs result and caches for runtime queries.
if (typeof globalThis !== "undefined" && !globalForPrisma._tsdbDetected) {
  globalForPrisma._tsdbDetected = true;
  detectTimescaleDb().catch(() => {
    // Swallowed — detectTimescaleDb already logs the warning
  });
}

// Seed DLP templates on startup (idempotent via upsert)
import { seedDlpTemplates } from "@/server/services/dlp-template-seed";
import { debugLog, errorLog } from "@/lib/logger";

seedDlpTemplates()
  .then(() => debugLog("startup", "DLP templates seeded"))
  .catch((err) => errorLog("startup", "Failed to seed DLP templates", err));
