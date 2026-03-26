"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { formatBytes, formatTimeAxis } from "@/lib/format";
import { Inbox } from "lucide-react";

interface FleetVolumeChartProps {
  data:
    | {
        bucket: string;
        bytesIn: number;
        bytesOut: number;
        eventsIn: number;
        eventsOut: number;
      }[]
    | undefined;
  isLoading: boolean;
  range: string;
}

const chartConfig: ChartConfig = {
  bytesIn: { label: "Bytes In", color: "oklch(0.55 0.24 265)" },
  bytesOut: { label: "Bytes Out", color: "oklch(0.65 0.17 163)" },
};

export function FleetVolumeChart({ data, isLoading, range }: FleetVolumeChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Data Volume Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const chartData = (data ?? []).map((d) => ({
    t: new Date(d.bucket).getTime(),
    bytesIn: d.bytesIn,
    bytesOut: d.bytesOut,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Data Volume Trend</CardTitle>
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
              <Area
                type="monotone"
                dataKey="bytesIn"
                stroke="var(--color-bytesIn)"
                fill="var(--color-bytesIn)"
                fillOpacity={0.2}
                strokeWidth={1.5}
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="bytesOut"
                stroke="var(--color-bytesOut)"
                fill="var(--color-bytesOut)"
                fillOpacity={0.2}
                strokeWidth={1.5}
                dot={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
