import { prisma } from "@/lib/prisma";

/** Cached detection result. null = not yet probed. */
let timescaleAvailable: boolean | null = null;

export interface TimescaleDbConfig {
  chunkInterval: string;
  compressAfter: string;
}

/**
 * Read TimescaleDB configuration from environment variables.
 * Returns defaults when env vars are unset.
 */
export function getTimescaleDbConfig(): TimescaleDbConfig {
  return {
    chunkInterval: process.env.METRICS_CHUNK_INTERVAL ?? "1 day",
    compressAfter: process.env.METRICS_COMPRESS_AFTER ?? "24 hours",
  };
}

/**
 * Detect whether TimescaleDB extension is available in the connected database.
 *
 * - `TIMESCALEDB_ENABLED=false` forces plain PostgreSQL mode.
 * - `TIMESCALEDB_ENABLED=true` forces TimescaleDB mode (skips probe).
 * - `TIMESCALEDB_ENABLED=auto` or unset performs actual detection.
 *
 * Result is cached after first successful probe.
 */
export async function detectTimescaleDb(): Promise<boolean> {
  const envOverride = process.env.TIMESCALEDB_ENABLED?.toLowerCase();

  if (envOverride === "false") {
    timescaleAvailable = false;
    return false;
  }

  if (envOverride === "true") {
    timescaleAvailable = true;
    return true;
  }

  // Auto-detect by querying pg_extension
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ extname: string; extversion: string }>
    >(
      "SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb'"
    );

    const found = rows.length > 0;
    timescaleAvailable = found;

    if (found) {
      console.log(
        `[timescaledb] TimescaleDB ${rows[0].extversion} detected — hypertable features enabled`
      );
    } else {
      console.warn(
        "[timescaledb] TimescaleDB extension not found — falling back to plain PostgreSQL. " +
          "Metrics retention will use deleteMany (slow at scale). " +
          "Install TimescaleDB for O(1) retention and 10-20x compression."
      );
    }

    return found;
  } catch {
    timescaleAvailable = false;
    console.warn(
      "[timescaledb] Failed to detect TimescaleDB — falling back to plain PostgreSQL"
    );
    return false;
  }
}

/**
 * Return the cached detection result.
 * Returns false if detectTimescaleDb() has not been called yet.
 */
export function isTimescaleDbAvailable(): boolean {
  return timescaleAvailable ?? false;
}
