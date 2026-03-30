// src/components/analytics/cost-kpi-cards.tsx
"use client";

import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CostSummaryResult, PipelineCostRow } from "@/server/services/cost-attribution";

interface CostKpiCardsProps {
  summary: CostSummaryResult | null;
  topPipelines: PipelineCostRow[];
  range: string;
}

function formatCost(cents: number): string {
  if (cents === 0) return "$0.00";
  if (cents >= 100_00) return `$${(cents / 100).toFixed(0)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function TrendArrow({ value }: { value: number | null }) {
  if (value == null || Math.abs(value) < 0.1) {
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
  const isUp = value > 0;
  return isUp ? (
    <ArrowUp className="h-4 w-4 text-red-600 dark:text-red-400" />
  ) : (
    <ArrowDown className="h-4 w-4 text-green-600 dark:text-green-400" />
  );
}

export function CostKpiCards({ summary, topPipelines, range }: CostKpiCardsProps) {
  const cur = summary?.current;
  const prev = summary?.previous;

  const bytesInTrend = cur && prev ? trendPercent(cur.bytesIn, prev.bytesIn) : null;
  const costTrend = cur && prev ? trendPercent(cur.costCents, prev.costCents) : null;

  const rangeLabel = range === "1d" ? "24h" : range === "7d" ? "7 days" : "30 days";

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {/* Total Bytes Processed */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Total Processed ({rangeLabel})
            </p>
            <TrendArrow value={bytesInTrend} />
          </div>
          <p className="mt-1 text-2xl font-bold">
            {cur ? formatBytes(cur.bytesIn) : "--"}
          </p>
          {bytesInTrend != null && (
            <p className="text-xs text-muted-foreground">
              {bytesInTrend >= 0 ? "+" : ""}
              {bytesInTrend.toFixed(1)}% vs previous period
            </p>
          )}
        </CardContent>
      </Card>

      {/* Estimated Cost */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Estimated Cost ({rangeLabel})
            </p>
            <TrendArrow value={costTrend} />
          </div>
          <p className="mt-1 text-2xl font-bold">
            {cur ? (cur.costCents > 0 ? formatCost(cur.costCents) : "Volume only") : "--"}
          </p>
          {costTrend != null && cur?.costCents !== undefined && cur.costCents > 0 && (
            <p className="text-xs text-muted-foreground">
              {costTrend >= 0 ? "+" : ""}
              {costTrend.toFixed(1)}% vs previous period
            </p>
          )}
        </CardContent>
      </Card>

      {/* Data Reduction */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground">
            Data Reduction
          </p>
          <p
            className={cn(
              "mt-1 text-2xl font-bold",
              cur && cur.bytesIn > 0 && (1 - cur.bytesOut / cur.bytesIn) * 100 > 50
                ? "text-green-600 dark:text-green-400"
                : "text-muted-foreground"
            )}
          >
            {cur && cur.bytesIn > 0
              ? `${((1 - cur.bytesOut / cur.bytesIn) * 100).toFixed(1)}%`
              : "--"}
          </p>
          <p className="text-xs text-muted-foreground">
            {cur ? `${formatBytes(cur.bytesIn)} in, ${formatBytes(cur.bytesOut)} out` : ""}
          </p>
        </CardContent>
      </Card>

      {/* Top Pipeline */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground">
            Top Pipeline by Volume
          </p>
          {topPipelines.length > 0 ? (
            <>
              <p className="mt-1 text-lg font-bold truncate" title={topPipelines[0].pipelineName}>
                {topPipelines[0].pipelineName}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(topPipelines[0].bytesIn)} processed
                {topPipelines[0].costCents > 0
                  ? ` (${formatCost(topPipelines[0].costCents)})`
                  : ""}
              </p>
            </>
          ) : (
            <p className="mt-1 text-2xl font-bold text-muted-foreground">--</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
