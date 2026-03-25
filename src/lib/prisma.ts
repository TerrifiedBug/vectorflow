import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,

    // Pool size: 2× realistic peak concurrent connections.
    // Override via DATABASE_POOL_MAX for workloads with higher parallelism.
    max: parseInt(process.env.DATABASE_POOL_MAX ?? "20", 10),

    // Fail fast on pool exhaustion instead of waiting indefinitely (pg default: 0 = no timeout).
    // 5 s is long enough for a healthy pool to recycle a connection but short enough to
    // surface saturation issues quickly in logs and error responses.
    connectionTimeoutMillis: parseInt(
      process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? "5000",
      10,
    ),

    // Keep idle connections warm for 30 s (pg default: 10 s).
    // Matches the typical heartbeat burst interval so connections survive between bursts
    // without accumulating stale handles.
    idleTimeoutMillis: parseInt(
      process.env.DATABASE_IDLE_TIMEOUT_MS ?? "30000",
      10,
    ),
  });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
