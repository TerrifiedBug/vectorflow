"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { formatPercent, formatTimeAxis } from "@/lib/format";
import { Inbox } from "lucide-react";

interface NodeCapacityBucket {
  bucket: string;
  memoryPct: number;
  diskPct: number;
  cpuLoad: number;
}

interface NodeCapacity {
  nodeId: string;
  nodeName: string;
  buckets: NodeCapacityBucket[];
}

interface FleetCapacityChartProps {
  data: NodeCapacity[] | undefined;
  isLoading: boolean;
  range: string;
}

// 8-color palette for distinguishing nodes
const NODE_COLORS = [
  "oklch(0.55 0.24 265)",
  "oklch(0.65 0.17 163)",
  "oklch(0.60 0.20 30)",
  "oklch(0.55 0.22 310)",
  "oklch(0.65 0.18 90)",
  "oklch(0.58 0.20 200)",
  "oklch(0.62 0.15 50)",
  "oklch(0.52 0.22 350)",
];

type MetricKey = "memoryPct" | "diskPct" | "cpuLoad";

function buildChartData(
  nodes: NodeCapacity[],
  metric: MetricKey,
): { t: number; [key: string]: number }[] {
  // Collect all unique timestamps across all nodes
  const timeSet = new Set<string>();
  for (const node of nodes) {
    for (const b of node.buckets) {
      timeSet.add(b.bucket);
    }
  }
  const times = Array.from(timeSet).sort();

  // Build lookup maps per node
  const nodeLookups = nodes.map((node) => {
    const map = new Map<string, number>();
    for (const b of node.buckets) {
      map.set(b.bucket, b[metric]);
    }
    return { nodeId: node.nodeId, map };
  });

  return times.map((t) => {
    const point: { t: number; [key: string]: number } = { t: new Date(t).getTime() };
    for (const { nodeId, map } of nodeLookups) {
      point[nodeId] = map.get(t) ?? 0;
    }
    return point;
  });
}

function buildConfig(nodes: NodeCapacity[]): ChartConfig {
  const config: ChartConfig = {};
  for (let i = 0; i < nodes.length; i++) {
    config[nodes[i].nodeId] = {
      label: nodes[i].nodeName,
      color: NODE_COLORS[i % NODE_COLORS.length],
    };
  }
  return config;
}

function CapacityMetricChart({
  title,
  nodes,
  metric,
  range,
  yFormatter,
  yDomain,
}: {
  title: string;
  nodes: NodeCapacity[];
  metric: MetricKey;
  range: string;
  yFormatter: (v: number) => string;
  yDomain?: [number, number];
}) {
  const chartData = buildChartData(nodes, metric);
  const chartConfig = buildConfig(nodes);

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex flex-col items-center justify-center text-muted-foreground"
            style={{ height: 200 }}
          >
            <Inbox className="h-6 w-6 text-muted-foreground/50" />
            <p className="mt-1 text-xs">No data</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Find peak node for this metric
  let peakNodeId = "";
  let peakValue = -1;
  for (const node of nodes) {
    for (const b of node.buckets) {
      if (b[metric] > peakValue) {
        peakValue = b[metric];
        peakNodeId = node.nodeId;
      }
    }
  }
  const peakNodeName = nodes.find((n) => n.nodeId === peakNodeId)?.nodeName;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {title}
          {nodes.length > 1 && peakNodeName && (
            <span className="ml-2 text-xs font-normal text-amber-500">
              Peak: {peakNodeName} ({yFormatter(peakValue)})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="w-full" style={{ height: 200 }}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => formatTimeAxis(v, range)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={50}
              tickFormatter={yFormatter}
              domain={yDomain ?? ["auto", "auto"]}
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
                        {yFormatter(value as number)}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {nodes.map((node, i) => (
              <Line
                key={node.nodeId}
                type="monotone"
                dataKey={node.nodeId}
                stroke={NODE_COLORS[i % NODE_COLORS.length]}
                strokeWidth={node.nodeId === peakNodeId ? 2.5 : 1.5}
                dot={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export function FleetCapacityChart({ data, isLoading, range }: FleetCapacityChartProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                <Skeleton className="h-4 w-24" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[200px] w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const nodes = data ?? [];

  if (nodes.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Node Capacity Utilization</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex flex-col items-center justify-center text-muted-foreground"
            style={{ height: 200 }}
          >
            <Inbox className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm">No capacity data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <CapacityMetricChart
        title="Memory Utilization"
        nodes={nodes}
        metric="memoryPct"
        range={range}
        yFormatter={(v) => formatPercent(v)}
        yDomain={[0, 100]}
      />
      <CapacityMetricChart
        title="Disk Utilization"
        nodes={nodes}
        metric="diskPct"
        range={range}
        yFormatter={(v) => formatPercent(v)}
        yDomain={[0, 100]}
      />
      <CapacityMetricChart
        title="CPU Load Average"
        nodes={nodes}
        metric="cpuLoad"
        range={range}
        yFormatter={(v) => v.toFixed(1)}
      />
    </div>
  );
}
