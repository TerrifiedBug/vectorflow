"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  LineChart,
  AreaChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { formatTimeAxis } from "@/lib/format";
import type { ReactNode } from "react";

type TSMap = Record<string, { t: number; v: number }[]>;

// 8 distinguishable colors cycling through shadcn chart CSS variables
const SERIES_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(221 83% 53%)", // blue
  "hsl(142 71% 45%)", // green
  "hsl(38 92% 50%)", // amber
];

/** Escape a string for safe use in CSS custom property names */
function cssEscape(s: string) {
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

interface MetricChartProps {
  title: string;
  icon?: ReactNode;
  /** Primary series (solid lines) */
  data: TSMap;
  /** Secondary series (dashed lines) — for in/out pairs */
  dataSecondary?: TSMap;
  /** "line" (default) or "area" */
  variant?: "line" | "area";
  /** Chart height in pixels */
  height?: number;
  /** Y-axis formatter */
  yFormatter?: (v: number) => string;
  /** Fixed Y-axis domain [min, max], or undefined for auto */
  yDomain?: [number, number];
  /** Time range for X-axis label formatting */
  timeRange: string;
  /** Label suffix for primary series in tooltip (e.g. " In") */
  primaryLabel?: string;
  /** Label suffix for secondary series in tooltip (e.g. " Out") */
  secondaryLabel?: string;
}

export function MetricChart({
  title,
  icon,
  data,
  dataSecondary,
  variant = "line",
  height = 250,
  yFormatter = (v) => String(v),
  yDomain,
  timeRange,
  primaryLabel = "",
  secondaryLabel = "",
}: MetricChartProps) {
  // Merge all series into a unified time-indexed dataset for Recharts
  const { chartData, seriesKeys, chartConfig } = useMemo(() => {
    const allLabels = Object.keys(data);
    const secLabels = dataSecondary ? Object.keys(dataSecondary) : [];

    // Build unique timestamp set
    const tsSet = new Set<number>();
    for (const pts of Object.values(data)) {
      for (const p of pts) tsSet.add(p.t);
    }
    if (dataSecondary) {
      for (const pts of Object.values(dataSecondary)) {
        for (const p of pts) tsSet.add(p.t);
      }
    }

    const timestamps = Array.from(tsSet).sort((a, b) => a - b);

    // Index series by timestamp for O(1) lookup
    const indexed = new Map<string, Map<number, number>>();
    for (const [label, pts] of Object.entries(data)) {
      const key = `${label}${primaryLabel}`;
      const m = new Map<number, number>();
      for (const p of pts) m.set(p.t, p.v);
      indexed.set(key, m);
    }
    if (dataSecondary) {
      for (const [label, pts] of Object.entries(dataSecondary)) {
        const key = `${label}${secondaryLabel}`;
        const m = new Map<number, number>();
        for (const p of pts) m.set(p.t, p.v);
        indexed.set(key, m);
      }
    }

    const keys = Array.from(indexed.keys());

    // Build chart data
    const chartData = timestamps.map((t) => {
      const row: Record<string, number> = { t };
      for (const key of keys) {
        row[key] = indexed.get(key)?.get(t) ?? 0;
      }
      return row;
    });

    // Build chart config
    const config: ChartConfig = {};
    let colorIdx = 0;
    for (const label of allLabels) {
      const color = SERIES_COLORS[colorIdx % SERIES_COLORS.length];
      const priKey = `${label}${primaryLabel}`;
      config[priKey] = { label: priKey, color };
      if (dataSecondary && secLabels.includes(label)) {
        const secKey = `${label}${secondaryLabel}`;
        config[secKey] = { label: secKey, color };
      }
      colorIdx++;
    }
    // Any secondary-only labels
    for (const label of secLabels) {
      if (!allLabels.includes(label)) {
        const color = SERIES_COLORS[colorIdx % SERIES_COLORS.length];
        const secKey = `${label}${secondaryLabel}`;
        config[secKey] = { label: secKey, color };
        colorIdx++;
      }
    }

    return { chartData, seriesKeys: keys, chartConfig: config };
  }, [data, dataSecondary, primaryLabel, secondaryLabel]);

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex items-center justify-center text-xs text-muted-foreground"
            style={{ height }}
          >
            No data for selected filters
          </div>
        </CardContent>
      </Card>
    );
  }

  const Chart = variant === "area" ? AreaChart : LineChart;

  // Determine which keys are primary vs secondary (for dashed styling)
  const primaryKeys = Object.keys(data).map((l) => `${l}${primaryLabel}`);
  const secondaryKeys = dataSecondary
    ? Object.keys(dataSecondary).map((l) => `${l}${secondaryLabel}`)
    : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height }}
        >
          <Chart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => formatTimeAxis(v, timeRange)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={55}
              tickFormatter={yFormatter}
              domain={yDomain ?? ["auto", "auto"]}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) =>
                    new Date(v as number).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  }
                  formatter={(value, name) => [
                    yFormatter(value as number),
                    name,
                  ]}
                />
              }
            />
            {/* Render series */}
            {variant === "area"
              ? seriesKeys.map((key) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={`var(--color-${cssEscape(key)})`}
                    fill={`var(--color-${cssEscape(key)})`}
                    fillOpacity={0.15}
                    strokeWidth={1.5}
                    strokeDasharray={
                      secondaryKeys.includes(key) ? "5 3" : undefined
                    }
                    dot={false}
                  />
                ))
              : seriesKeys.map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={`var(--color-${cssEscape(key)})`}
                    strokeWidth={1.5}
                    strokeDasharray={
                      secondaryKeys.includes(key) ? "5 3" : undefined
                    }
                    dot={false}
                  />
                ))}
            {seriesKeys.length <= 12 && (
              <ChartLegend content={<ChartLegendContent />} />
            )}
          </Chart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
