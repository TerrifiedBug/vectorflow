import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TimeRange = "1h" | "6h" | "1d" | "7d" | "30d";

export interface FleetOverview {
  bytesIn: number;
  bytesOut: number;
  eventsIn: number;
  eventsOut: number;
  errorRate: number;
  nodeCount: number;
}

export interface VolumeBucket {
  bucket: string;
  bytesIn: number;
  bytesOut: number;
  eventsIn: number;
  eventsOut: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const RANGE_MS: Record<TimeRange, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const BUCKET_SIZE: Record<TimeRange, string> = {
  "1h": "minute",
  "6h": "hour",
  "1d": "hour",
  "7d": "day",
  "30d": "day",
};

function sinceDate(range: TimeRange): Date {
  return new Date(Date.now() - RANGE_MS[range]);
}

// ─── Fleet Overview ─────────────────────────────────────────────────────────

export async function getFleetOverview(
  environmentId: string,
  range: TimeRange,
): Promise<FleetOverview> {
  const since = sinceDate(range);

  const [metricRows, nodeRows] = await Promise.all([
    prisma.$queryRaw<
      {
        bytes_in: bigint | null;
        bytes_out: bigint | null;
        events_in: bigint | null;
        events_out: bigint | null;
        errors_total: bigint | null;
      }[]
    >(Prisma.sql`
      SELECT
        SUM("bytesIn")      AS bytes_in,
        SUM("bytesOut")     AS bytes_out,
        SUM("eventsIn")     AS events_in,
        SUM("eventsOut")    AS events_out,
        SUM("errorsTotal")  AS errors_total
      FROM "PipelineMetric"
      WHERE "componentId" IS NULL
        AND "timestamp" >= ${since}
        AND "pipelineId" IN (
          SELECT "id" FROM "Pipeline" WHERE "environmentId" = ${environmentId}
        )
    `),
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM "VectorNode"
      WHERE "environmentId" = ${environmentId}
    `),
  ]);

  const m = metricRows[0];
  const bytesIn = Number(m?.bytes_in ?? 0);
  const bytesOut = Number(m?.bytes_out ?? 0);
  const eventsIn = Number(m?.events_in ?? 0);
  const eventsOut = Number(m?.events_out ?? 0);
  const errorsTotal = Number(m?.errors_total ?? 0);
  const nodeCount = Number(nodeRows[0]?.count ?? 0);
  const errorRate = eventsIn > 0 ? errorsTotal / eventsIn : 0;

  return { bytesIn, bytesOut, eventsIn, eventsOut, errorRate, nodeCount };
}

// ─── Volume Trend ───────────────────────────────────────────────────────────

export async function getVolumeTrend(
  environmentId: string,
  range: TimeRange,
): Promise<VolumeBucket[]> {
  const since = sinceDate(range);
  const bucket = BUCKET_SIZE[range];

  const rows = await prisma.$queryRaw<
    {
      bucket: Date;
      bytes_in: bigint | null;
      bytes_out: bigint | null;
      events_in: bigint | null;
      events_out: bigint | null;
    }[]
  >(Prisma.sql`
    SELECT
      date_trunc(${bucket}, "timestamp") AS bucket,
      SUM("bytesIn")   AS bytes_in,
      SUM("bytesOut")  AS bytes_out,
      SUM("eventsIn")  AS events_in,
      SUM("eventsOut") AS events_out
    FROM "PipelineMetric"
    WHERE "componentId" IS NULL
      AND "timestamp" >= ${since}
      AND "pipelineId" IN (
        SELECT "id" FROM "Pipeline" WHERE "environmentId" = ${environmentId}
      )
    GROUP BY 1
    ORDER BY 1
  `);

  return rows.map((r) => ({
    bucket: (r.bucket instanceof Date ? r.bucket : new Date(r.bucket)).toISOString(),
    bytesIn: Number(r.bytes_in ?? 0),
    bytesOut: Number(r.bytes_out ?? 0),
    eventsIn: Number(r.events_in ?? 0),
    eventsOut: Number(r.events_out ?? 0),
  }));
}
