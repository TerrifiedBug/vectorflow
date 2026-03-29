// src/components/analytics/cost-chart.tsx
"use client";

import { useMemo } from "react";
import { Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatTimeAxis } from "@/lib/format";
import type { CostTimeSeriesBucket } from "@/server/services/cost-attribution";

// Color palette for stacked series
const COLORS = [
  "oklch(0.55 0.24 265)",
  "oklch(0.65 0.17 163)",
  "oklch(0.6 0.2 30)",
  "oklch(0.55 0.2 310)",
  "oklch(0.65 0.15 80)",
  "oklch(0.5 0.22 200)",
  "oklch(0.6 0.18 350)",
  "oklch(0.55 0.16 130)",
];

interface CostChartProps {
  data: CostTimeSeriesBucket[];
  range: string;
  isLoading: boolean;
}

export function CostChart({ data, range, isLoading }: CostChartProps) {
  // Flatten series into chart-compatible format
  const { chartData, seriesKeys, chartConfig } = useMemo(() => {
    if (data.length === 0) {
      return { chartData: [], seriesKeys: [] as string[], chartConfig: {} as ChartConfig };
    }

    // Collect all series keys
    const keySet = new Set<string>();
    for (const bucket of data) {
      for (const key of Object.keys(bucket.series)) {
        keySet.add(key);
      }
    }
    const keys = Array.from(keySet).sort();

    const config: ChartConfig = {};
    keys.forEach((key, i) => {
      config[key] = {
        label: key,
        color: COLORS[i % COLORS.length],
      };
    });

    const flat = data.map((bucket) => {
      const row: Record<string, number> = {
        t: new Date(bucket.bucket).getTime(),
      };
      for (const key of keys) {
        row[key] = bucket.series[key]?.bytesIn ?? 0;
      }
      return row;
    });

    return { chartData: flat, seriesKeys: keys, chartConfig: config };
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          Volume Over Time (Bytes In)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-muted-foreground"
            style={{ height: 300 }}
          >
            <Inbox className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm">No data for selected time range</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="w-full" style={{ height: 300 }}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => formatTimeAxis(v, range)}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                width={65}
                tickFormatter={formatBytes}
                domain={["auto", "auto"]}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_value: string, payload: Array<{ payload?: { t?: number } }>) => {
                      const timestamp = payload?.[0]?.payload?.t;
                      if (!timestamp) return "";
                      return new Date(Number(timestamp)).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                    }}
                    formatter={(value, name) => (
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {chartConfig[name as string]?.label ?? name}
                        </span>
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {formatBytes(value as number)}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              {seriesKeys.map((key, i) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stackId="1"
                  stroke={COLORS[i % COLORS.length]}
                  fill={COLORS[i % COLORS.length]}
                  fillOpacity={0.3}
                  strokeWidth={1.5}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
