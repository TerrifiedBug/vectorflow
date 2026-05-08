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
  versionDriftCount: number;
  configDriftCount: number;
}

export interface VolumeBucket {
  bucket: string;
  bytesIn: number;
  bytesOut: number;
  eventsIn: number;
  eventsOut: number;
}

export interface NodeThroughput {
  nodeId: string;
  nodeName: string;
  bytesIn: number;
  bytesOut: number;
  eventsIn: number;
  eventsOut: number;
}

export interface NodeCapacityBucket {
  bucket: string;
  memoryPct: number;
  diskPct: number;
  cpuLoad: number;
}

export interface NodeCapacity {
  nodeId: string;
  nodeName: string;
  buckets: NodeCapacityBucket[];
}

export interface PipelineDataLoss {
  pipelineId: string;
  pipelineName: string;
  eventsIn: number;
  eventsOut: number;
  eventsDiscarded: number;
  lossRate: number;
}

export interface MatrixCellThroughput {
  pipelineId: string;
  nodeId: string;
  eventsPerSec: number;
  bytesPerSec: number;
  lossRate: number;
}

export interface CpuHeatmapCell {
  nodeId: string;
  nodeName: string;
  bucket: string;
  cpuLoad: number;
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

  // Compute drift stats
  const [pipelineStatuses, deployedPipelines] = await Promise.all([
    prisma.nodePipelineStatus.findMany({
      where: {
        node: { environmentId },
      },
      select: {
        nodeId: true,
        pipelineId: true,
        version: true,
        configChecksum: true,
      },
    }),
    prisma.pipeline.findMany({
      where: {
        environmentId,
        isDraft: false,
        deployedAt: { not: null },
      },
      select: {
        id: true,
        versions: {
          orderBy: { version: "desc" as const },
          take: 1,
          select: { version: true },
        },
      },
    }),
  ]);

  // Build latest version map
  const latestVersionMap = new Map<string, number>();
  for (const p of deployedPipelines) {
    latestVersionMap.set(p.id, p.versions[0]?.version ?? 1);
  }

  // Count pipelines with version drift (any node running non-latest version)
  const pipelineVersions = new Map<string, Set<number>>();
  for (const s of pipelineStatuses) {
    const versions = pipelineVersions.get(s.pipelineId) ?? new Set();
    versions.add(s.version);
    pipelineVersions.set(s.pipelineId, versions);
  }

  let versionDriftCount = 0;
  for (const [pipelineId, versions] of pipelineVersions.entries()) {
    const latest = latestVersionMap.get(pipelineId);
    if (latest === undefined) continue;
    const hasNonLatest = [...versions].some((v) => v !== latest);
    if (hasNonLatest) versionDriftCount++;
  }

  // Config drift: count pipelines where any node's reported checksum differs
  // from the expected checksum in the drift-metrics cache.
  const { getExpectedChecksums } = await import("@/server/services/drift-metrics");
  const pipelineIdsWithChecksum = pipelineStatuses
    .filter((s) => s.configChecksum != null)
    .map((s) => s.pipelineId);
  const expectedChecksums = getExpectedChecksums([...new Set(pipelineIdsWithChecksum)]);
  const configDriftPipelines = new Set<string>();
  for (const s of pipelineStatuses) {
    if (s.configChecksum == null) continue;
    const expected = expectedChecksums.get(s.pipelineId);
    if (expected && s.configChecksum !== expected) {
      configDriftPipelines.add(s.pipelineId);
    }
  }
  const configDriftCount = configDriftPipelines.size;

  return {
    bytesIn,
    bytesOut,
    eventsIn,
    eventsOut,
    errorRate,
    nodeCount,
    versionDriftCount,
    configDriftCount,
  };
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

// ─── Node Throughput Comparison ──────────────────────────────────────────────

export async function getNodeThroughput(
  environmentId: string,
  range: TimeRange,
): Promise<NodeThroughput[]> {
  const since = sinceDate(range);

  const rows = await prisma.$queryRaw<
    {
      node_id: string;
      node_name: string;
      bytes_in: bigint | null;
      bytes_out: bigint | null;
      events_in: bigint | null;
      events_out: bigint | null;
    }[]
  >(Prisma.sql`
    SELECT
      n."id"            AS node_id,
      n."name"          AS node_name,
      SUM(pm."bytesIn")  AS bytes_in,
      SUM(pm."bytesOut") AS bytes_out,
      SUM(pm."eventsIn") AS events_in,
      SUM(pm."eventsOut") AS events_out
    FROM "PipelineMetric" pm
    JOIN "VectorNode" n ON n."id" = pm."nodeId"
    WHERE pm."componentId" IS NULL
      AND pm."nodeId" IS NOT NULL
      AND pm."timestamp" >= ${since}
      AND n."environmentId" = ${environmentId}
    GROUP BY n."id", n."name"
    ORDER BY SUM(pm."bytesIn") DESC
  `);

  return rows.map((r) => ({
    nodeId: r.node_id,
    nodeName: r.node_name,
    bytesIn: Number(r.bytes_in ?? 0),
    bytesOut: Number(r.bytes_out ?? 0),
    eventsIn: Number(r.events_in ?? 0),
    eventsOut: Number(r.events_out ?? 0),
  }));
}

// ─── Node Capacity Utilization ───────────────────────────────────────────────

export async function getNodeCapacity(
  environmentId: string,
  range: TimeRange,
): Promise<NodeCapacity[]> {
  const since = sinceDate(range);
  const bucket = BUCKET_SIZE[range];

  const rows = await prisma.$queryRaw<
    {
      node_id: string;
      node_name: string;
      bucket: Date;
      memory_pct: number | null;
      disk_pct: number | null;
      cpu_load: number | null;
    }[]
  >(Prisma.sql`
    SELECT
      nm."nodeId"        AS node_id,
      n."name"           AS node_name,
      date_trunc(${bucket}, nm."timestamp") AS bucket,
      AVG(CASE WHEN nm."memoryTotalBytes" > 0
        THEN nm."memoryUsedBytes"::float / nm."memoryTotalBytes" * 100
        ELSE 0 END)     AS memory_pct,
      AVG(CASE WHEN nm."fsTotalBytes" > 0
        THEN nm."fsUsedBytes"::float / nm."fsTotalBytes" * 100
        ELSE 0 END)     AS disk_pct,
      AVG(nm."loadAvg1") AS cpu_load
    FROM "NodeMetric" nm
    JOIN "VectorNode" n ON n."id" = nm."nodeId"
    WHERE n."environmentId" = ${environmentId}
      AND nm."timestamp" >= ${since}
    GROUP BY 1, 2, 3
    ORDER BY 1, 3
  `);

  // Group flat rows into per-node capacity objects
  const nodeMap = new Map<string, NodeCapacity>();
  for (const r of rows) {
    let node = nodeMap.get(r.node_id);
    if (!node) {
      node = { nodeId: r.node_id, nodeName: r.node_name, buckets: [] };
      nodeMap.set(r.node_id, node);
    }
    node.buckets.push({
      bucket: (r.bucket instanceof Date ? r.bucket : new Date(r.bucket)).toISOString(),
      memoryPct: Math.round((r.memory_pct ?? 0) * 10) / 10,
      diskPct: Math.round((r.disk_pct ?? 0) * 10) / 10,
      cpuLoad: Math.round((r.cpu_load ?? 0) * 100) / 100,
    });
  }

  return Array.from(nodeMap.values());
}

// ─── CPU Heatmap ─────────────────────────────────────────────────────────────

export async function getCpuHeatmap(
  environmentId: string,
  range: TimeRange,
): Promise<CpuHeatmapCell[]> {
  const since = sinceDate(range);
  const bucket = BUCKET_SIZE[range];

  const rows = await prisma.$queryRaw<
    {
      node_id: string;
      node_name: string;
      bucket: Date;
      cpu_load: number | null;
    }[]
  >(Prisma.sql`
    SELECT
      nm."nodeId" AS node_id,
      n."name" AS node_name,
      date_trunc(${bucket}, nm."timestamp") AS bucket,
      AVG(nm."loadAvg1") AS cpu_load
    FROM "NodeMetric" nm
    JOIN "VectorNode" n ON n."id" = nm."nodeId"
    WHERE n."environmentId" = ${environmentId}
      AND nm."timestamp" >= ${since}
    GROUP BY 1, 2, 3
    ORDER BY 2, 3
  `);

  return rows.map((r) => ({
    nodeId: r.node_id,
    nodeName: r.node_name,
    bucket: (r.bucket instanceof Date ? r.bucket : new Date(r.bucket)).toISOString(),
    cpuLoad: Math.round((r.cpu_load ?? 0) * 100) / 100,
  }));
}

// ─── Data Loss Detection ────────────────────────────────────────────────────

export async function getDataLoss(
  environmentId: string,
  range: TimeRange,
  threshold: number = 0.05,
): Promise<PipelineDataLoss[]> {
  const since = sinceDate(range);

  const rows = await prisma.$queryRaw<
    {
      pipeline_id: string;
      pipeline_name: string;
      events_in: bigint | null;
      events_out: bigint | null;
      events_discarded: bigint | null;
    }[]
  >(Prisma.sql`
    SELECT
      p."id"                      AS pipeline_id,
      p."name"                    AS pipeline_name,
      SUM(pm."eventsIn")          AS events_in,
      SUM(pm."eventsOut")         AS events_out,
      SUM(pm."eventsDiscarded")   AS events_discarded
    FROM "PipelineMetric" pm
    JOIN "Pipeline" p ON p."id" = pm."pipelineId"
    WHERE pm."componentId" IS NULL
      AND pm."timestamp" >= ${since}
      AND p."environmentId" = ${environmentId}
    GROUP BY p."id", p."name"
    ORDER BY p."name"
  `);

  const results: PipelineDataLoss[] = [];
  for (const r of rows) {
    const eventsIn = Number(r.events_in ?? 0);
    const eventsOut = Number(r.events_out ?? 0);
    const eventsDiscarded = Number(r.events_discarded ?? 0);
    if (eventsIn === 0) continue;
    const actualLoss = eventsIn - eventsOut - eventsDiscarded;
    const lossRate = actualLoss > 0 ? actualLoss / eventsIn : 0;
    if (lossRate <= threshold) continue;
    results.push({
      pipelineId: r.pipeline_id,
      pipelineName: r.pipeline_name,
      eventsIn,
      eventsOut,
      eventsDiscarded,
      lossRate: Math.round(lossRate * 10000) / 10000,
    });
  }

  return results.sort((a, b) => b.lossRate - a.lossRate);
}

// ─── Matrix Throughput ──────────────────────────────────────────────────────

export async function getMatrixThroughput(
  environmentId: string,
  range: TimeRange,
): Promise<MatrixCellThroughput[]> {
  const since = sinceDate(range);
  const windowSeconds = RANGE_MS[range] / 1000;

  const rows = await prisma.$queryRaw<
    {
      pipeline_id: string;
      node_id: string;
      events_in: bigint | null;
      events_out: bigint | null;
      bytes_in: bigint | null;
      bytes_out: bigint | null;
    }[]
  >(Prisma.sql`
    SELECT
      pm."pipelineId"      AS pipeline_id,
      pm."nodeId"          AS node_id,
      SUM(pm."eventsIn")   AS events_in,
      SUM(pm."eventsOut")  AS events_out,
      SUM(pm."bytesIn")    AS bytes_in,
      SUM(pm."bytesOut")   AS bytes_out
    FROM "PipelineMetric" pm
    JOIN "Pipeline" p ON p."id" = pm."pipelineId"
    WHERE pm."componentId" IS NULL
      AND pm."nodeId" IS NOT NULL
      AND pm."timestamp" >= ${since}
      AND p."environmentId" = ${environmentId}
    GROUP BY pm."pipelineId", pm."nodeId"
  `);

  return rows.map((r) => {
    const eventsIn = Number(r.events_in ?? 0);
    const eventsOut = Number(r.events_out ?? 0);
    const bytesIn = Number(r.bytes_in ?? 0);
    const bytesOut = Number(r.bytes_out ?? 0);
    const lossRate = eventsIn > 0 ? (eventsIn - eventsOut) / eventsIn : 0;
    return {
      pipelineId: r.pipeline_id,
      nodeId: r.node_id,
      eventsPerSec: Math.round((eventsIn / windowSeconds) * 100) / 100,
      bytesPerSec: Math.round((bytesIn + bytesOut) / windowSeconds),
      lossRate: Math.round(Math.max(0, lossRate) * 10000) / 10000,
    };
  });
}
