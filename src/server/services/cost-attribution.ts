// src/server/services/cost-attribution.ts
import { prisma } from "@/lib/prisma";

// ─── Constants ─────────────────────────────────────────────────────────────

const BYTES_PER_GB = 1_073_741_824; // 1 GiB

const RANGE_HOURS: Record<string, number> = {
  "1h": 1,
  "6h": 6,
  "1d": 24,
  "7d": 168,
  "30d": 720,
};

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CostSummaryInput {
  environmentId: string;
  range: string;
  costPerGbCents: number;
}

export interface CostSummaryResult {
  current: {
    bytesIn: number;
    bytesOut: number;
    costCents: number;
  };
  previous: {
    bytesIn: number;
    bytesOut: number;
    costCents: number;
  };
}

export interface PipelineCostRow {
  pipelineId: string;
  pipelineName: string;
  teamName: string;
  environmentName: string;
  bytesIn: number;
  bytesOut: number;
  reductionPercent: number;
  costCents: number;
}

export interface TeamCostRow {
  teamId: string;
  teamName: string;
  bytesIn: number;
  bytesOut: number;
  costCents: number;
  pipelineCount: number;
}

export interface EnvironmentCostRow {
  environmentId: string;
  environmentName: string;
  costPerGbCents: number;
  bytesIn: number;
  bytesOut: number;
  costCents: number;
}

export interface CostTimeSeriesBucket {
  bucket: string; // ISO timestamp
  series: Record<string, { bytesIn: number; bytesOut: number; costCents: number }>;
}

export interface CostTimeSeriesInput {
  environmentId: string;
  range: string;
  costPerGbCents: number;
  groupBy: "pipeline" | "team";
}

export interface TeamCostInput {
  teamIds: string[];
  range: string;
}

export interface EnvironmentCostInput {
  environmentIds: string[];
  range: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Convert bytes processed to cost in cents using the environment rate. */
export function computeCostCents(bytesIn: number, costPerGbCents: number): number {
  if (costPerGbCents === 0 || bytesIn === 0) return 0;
  return Math.round((bytesIn / BYTES_PER_GB) * costPerGbCents);
}

function rangeToSince(range: string): Date {
  const hours = RANGE_HOURS[range] ?? 24;
  return new Date(Date.now() - hours * 3_600_000);
}

function rangeToBucketMs(range: string): number {
  const hours = RANGE_HOURS[range] ?? 24;
  if (hours <= 1) return 60_000;        // 1 min
  if (hours <= 6) return 300_000;       // 5 min
  if (hours <= 24) return 900_000;      // 15 min
  if (hours <= 168) return 3_600_000;   // 1 hour
  return 14_400_000;                    // 4 hours
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── Service functions ─────────────────────────────────────────────────────

/** Get aggregated cost summary for an environment over a time range. */
export async function getCostSummary(
  input: CostSummaryInput
): Promise<CostSummaryResult> {
  const { environmentId, range, costPerGbCents } = input;
  const hours = RANGE_HOURS[range] ?? 24;
  const since = rangeToSince(range);
  const prevSince = new Date(since.getTime() - hours * 3_600_000);

  const [current, previous] = await Promise.all([
    prisma.pipelineMetric.aggregate({
      where: {
        pipeline: { environmentId },
        componentId: null,
        timestamp: { gte: since },
      },
      _sum: { bytesIn: true, bytesOut: true },
    }),
    prisma.pipelineMetric.aggregate({
      where: {
        pipeline: { environmentId },
        componentId: null,
        timestamp: { gte: prevSince, lt: since },
      },
      _sum: { bytesIn: true, bytesOut: true },
    }),
  ]);

  const curBytesIn = Number(current._sum.bytesIn ?? 0);
  const curBytesOut = Number(current._sum.bytesOut ?? 0);
  const prevBytesIn = Number(previous._sum.bytesIn ?? 0);
  const prevBytesOut = Number(previous._sum.bytesOut ?? 0);

  return {
    current: {
      bytesIn: curBytesIn,
      bytesOut: curBytesOut,
      costCents: computeCostCents(curBytesIn, costPerGbCents),
    },
    previous: {
      bytesIn: prevBytesIn,
      bytesOut: prevBytesOut,
      costCents: computeCostCents(prevBytesIn, costPerGbCents),
    },
  };
}

/** Get per-pipeline cost breakdown. */
export async function getCostByPipeline(
  input: CostSummaryInput
): Promise<PipelineCostRow[]> {
  const { environmentId, range, costPerGbCents } = input;
  const since = rangeToSince(range);

  const byPipeline = await prisma.pipelineMetric.groupBy({
    by: ["pipelineId"],
    where: {
      pipeline: { environmentId },
      componentId: null,
      timestamp: { gte: since },
    },
    _sum: { bytesIn: true, bytesOut: true },
  });

  if (byPipeline.length === 0) return [];

  const pipelineIds = byPipeline.map((p) => p.pipelineId);
  const pipelines = await prisma.pipeline.findMany({
    where: { id: { in: pipelineIds } },
    select: {
      id: true,
      name: true,
      environmentId: true,
      environment: {
        select: {
          id: true,
          name: true,
          teamId: true,
          team: { select: { id: true, name: true } },
        },
      },
    },
  });

  const pipelineMap = new Map(pipelines.map((p) => [p.id, p]));

  return byPipeline.map((row) => {
    const pipeline = pipelineMap.get(row.pipelineId);
    const bytesIn = Number(row._sum.bytesIn ?? 0);
    const bytesOut = Number(row._sum.bytesOut ?? 0);
    const reductionPercent = bytesIn > 0
      ? Math.max(0, (1 - bytesOut / bytesIn) * 100)
      : 0;

    return {
      pipelineId: row.pipelineId,
      pipelineName: pipeline?.name ?? "Unknown",
      teamName: pipeline?.environment.team?.name ?? "Unassigned",
      environmentName: pipeline?.environment.name ?? "Unknown",
      bytesIn,
      bytesOut,
      reductionPercent,
      costCents: computeCostCents(bytesIn, costPerGbCents),
    };
  });
}

/** Aggregate pipeline costs by team for chargeback reporting. */
export async function getCostByTeam(
  input: TeamCostInput
): Promise<TeamCostRow[]> {
  const { teamIds, range } = input;
  const since = rangeToSince(range);

  const byPipeline = await prisma.pipelineMetric.groupBy({
    by: ["pipelineId"],
    where: {
      pipeline: {
        environment: { teamId: { in: teamIds } },
      },
      componentId: null,
      timestamp: { gte: since },
    },
    _sum: { bytesIn: true, bytesOut: true },
  });

  if (byPipeline.length === 0) return [];

  const pipelineIds = byPipeline.map((p) => p.pipelineId);
  const pipelines = await prisma.pipeline.findMany({
    where: { id: { in: pipelineIds } },
    select: {
      id: true,
      name: true,
      environment: {
        select: {
          teamId: true,
          team: { select: { id: true, name: true } },
          costPerGbCents: true,
        },
      },
    },
  });

  const pipelineMap = new Map(pipelines.map((p) => [p.id, p]));

  // Aggregate by team
  const teamAgg = new Map<
    string,
    { teamName: string; bytesIn: number; bytesOut: number; costCents: number; pipelineCount: number }
  >();

  for (const row of byPipeline) {
    const pipeline = pipelineMap.get(row.pipelineId);
    const teamId = pipeline?.environment.teamId ?? "unknown";
    const teamName = pipeline?.environment.team?.name ?? "Unassigned";
    const costPerGbCents = pipeline?.environment.costPerGbCents ?? 0;
    const bytesIn = Number(row._sum.bytesIn ?? 0);
    const bytesOut = Number(row._sum.bytesOut ?? 0);

    const existing = teamAgg.get(teamId) ?? {
      teamName,
      bytesIn: 0,
      bytesOut: 0,
      costCents: 0,
      pipelineCount: 0,
    };
    existing.bytesIn += bytesIn;
    existing.bytesOut += bytesOut;
    existing.costCents += computeCostCents(bytesIn, costPerGbCents);
    existing.pipelineCount += 1;
    teamAgg.set(teamId, existing);
  }

  return Array.from(teamAgg.entries()).map(([teamId, data]) => ({
    teamId,
    ...data,
  }));
}

/** Compare costs across environments. */
export async function getCostByEnvironment(
  input: EnvironmentCostInput
): Promise<EnvironmentCostRow[]> {
  const { environmentIds, range } = input;
  const since = rangeToSince(range);

  const environments = await prisma.environment.findMany({
    where: { id: { in: environmentIds } },
    select: { id: true, name: true, costPerGbCents: true },
  });

  const results: EnvironmentCostRow[] = [];

  for (const env of environments) {
    const agg = await prisma.pipelineMetric.aggregate({
      where: {
        pipeline: { environmentId: env.id },
        componentId: null,
        timestamp: { gte: since },
      },
      _sum: { bytesIn: true, bytesOut: true },
    });

    const bytesIn = Number(agg._sum.bytesIn ?? 0);
    const bytesOut = Number(agg._sum.bytesOut ?? 0);

    results.push({
      environmentId: env.id,
      environmentName: env.name,
      costPerGbCents: env.costPerGbCents,
      bytesIn,
      bytesOut,
      costCents: computeCostCents(bytesIn, env.costPerGbCents),
    });
  }

  return results;
}

/** Get time series data for volume trend chart. */
export async function getCostTimeSeries(
  input: CostTimeSeriesInput
): Promise<CostTimeSeriesBucket[]> {
  const { environmentId, range, costPerGbCents, groupBy } = input;
  const since = rangeToSince(range);
  const bucketMs = rangeToBucketMs(range);

  const rawMetrics = await prisma.pipelineMetric.findMany({
    where: {
      pipeline: { environmentId },
      componentId: null,
      timestamp: { gte: since },
    },
    select: {
      pipelineId: true,
      timestamp: true,
      bytesIn: true,
      bytesOut: true,
    },
    orderBy: { timestamp: "desc" },
    take: 50_000,
  });

  // Resolve pipeline → name/team mappings
  const pipelineIds = [...new Set(rawMetrics.map((m) => m.pipelineId))];
  const pipelines = await prisma.pipeline.findMany({
    where: { id: { in: pipelineIds } },
    select: {
      id: true,
      name: true,
      environment: {
        select: {
          team: { select: { name: true } },
        },
      },
    },
  });

  const pipelineNameMap = new Map(pipelines.map((p) => [p.id, p.name]));
  const pipelineTeamMap = new Map(
    pipelines.map((p) => [p.id, p.environment.team?.name ?? "Unassigned"])
  );

  // Bucket raw metrics
  const buckets = new Map<
    number,
    Map<string, { bytesIn: number; bytesOut: number }>
  >();

  for (const m of rawMetrics) {
    const t = Math.floor(new Date(m.timestamp).getTime() / bucketMs) * bucketMs;
    const label =
      groupBy === "team"
        ? (pipelineTeamMap.get(m.pipelineId) ?? "Unknown")
        : (pipelineNameMap.get(m.pipelineId) ?? m.pipelineId);

    if (!buckets.has(t)) buckets.set(t, new Map());
    const seriesMap = buckets.get(t)!;
    const existing = seriesMap.get(label) ?? { bytesIn: 0, bytesOut: 0 };
    existing.bytesIn += Number(m.bytesIn ?? 0);
    existing.bytesOut += Number(m.bytesOut ?? 0);
    seriesMap.set(label, existing);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, seriesMap]) => {
      const series: Record<string, { bytesIn: number; bytesOut: number; costCents: number }> = {};
      for (const [label, data] of seriesMap) {
        series[label] = {
          bytesIn: data.bytesIn,
          bytesOut: data.bytesOut,
          costCents: computeCostCents(data.bytesIn, costPerGbCents),
        };
      }
      return {
        bucket: new Date(t).toISOString(),
        series,
      };
    });
}

/** Format pipeline cost rows as CSV for finance/chargeback reporting. */
export function formatCostCsv(rows: PipelineCostRow[]): string {
  const header = "Pipeline,Team,Environment,Bytes In,Bytes Out,Reduction %,Cost ($)";
  const lines = rows.map((r) =>
    [
      escapeCsvField(r.pipelineName),
      escapeCsvField(r.teamName),
      escapeCsvField(r.environmentName),
      r.bytesIn,
      r.bytesOut,
      r.reductionPercent.toFixed(1),
      (r.costCents / 100).toFixed(2),
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

/** Get current month's cost for budget alert evaluation. */
export async function getCurrentMonthCostCents(
  environmentId: string,
  costPerGbCents: number
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const agg = await prisma.pipelineMetric.aggregate({
    where: {
      pipeline: { environmentId },
      componentId: null,
      timestamp: { gte: monthStart },
    },
    _sum: { bytesIn: true },
  });

  return computeCostCents(Number(agg._sum.bytesIn ?? 0), costPerGbCents);
}
