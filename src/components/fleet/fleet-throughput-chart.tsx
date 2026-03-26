"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { formatBytes } from "@/lib/format";
import { Inbox } from "lucide-react";

interface NodeThroughput {
  nodeId: string;
  nodeName: string;
  bytesIn: number;
  bytesOut: number;
  eventsIn: number;
  eventsOut: number;
}

interface FleetThroughputChartProps {
  data: NodeThroughput[] | undefined;
  isLoading: boolean;
}

const chartConfig: ChartConfig = {
  bytesIn: { label: "Bytes In", color: "oklch(0.55 0.24 265)" },
  bytesOut: { label: "Bytes Out", color: "oklch(0.65 0.17 163)" },
};

export function FleetThroughputChart({ data, isLoading }: FleetThroughputChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Node Throughput Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const chartData = (data ?? []).map((d) => ({
    name: d.nodeName,
    bytesIn: d.bytesIn,
    bytesOut: d.bytesOut,
  }));

  // Find the node with highest total throughput for highlighting
  const maxIdx = chartData.reduce(
    (max, d, i) => (d.bytesIn + d.bytesOut > (chartData[max]?.bytesIn ?? 0) + (chartData[max]?.bytesOut ?? 0) ? i : max),
    0,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Node Throughput Comparison
          {chartData.length > 1 && chartData[maxIdx] && (
            <span className="ml-2 text-xs font-normal text-amber-500">
              Bottleneck: {chartData[maxIdx].name}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-muted-foreground"
            style={{ height: 300 }}
          >
            <Inbox className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm">No node throughput data</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="w-full" style={{ height: 300 }}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={chartData.length > 6 ? -45 : 0}
                textAnchor={chartData.length > 6 ? "end" : "middle"}
                height={chartData.length > 6 ? 60 : 30}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                width={65}
                tickFormatter={formatBytes}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
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
              <Bar
                dataKey="bytesIn"
                fill="var(--color-bytesIn)"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="bytesOut"
                fill="var(--color-bytesOut)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
