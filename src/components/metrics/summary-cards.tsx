"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { MetricSample } from "@/server/services/metric-store";

interface SummaryCardsProps {
  allSamples: Record<string, { samples: MetricSample[] }>;
}

function formatRate(rate: number): string {
  if (rate >= 1000000) return `${(rate / 1000000).toFixed(1)}M/s`;
  if (rate >= 1000) return `${(rate / 1000).toFixed(1)}K/s`;
  return `${Math.round(rate)}/s`;
}

export function SummaryCards({ allSamples }: SummaryCardsProps) {
  const entries = Object.values(allSamples);
  let totalIn = 0;
  let totalOut = 0;

  for (const { samples } of entries) {
    if (samples.length > 0) {
      totalIn += samples[samples.length - 1].receivedEventsRate;
      totalOut += samples[samples.length - 1].sentEventsRate;
    }
  }

  const errorRate = totalIn > 0 ? ((totalIn - totalOut) / totalIn) * 100 : 0;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Events In</p>
          <p className="text-2xl font-bold">{formatRate(totalIn)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Events Out</p>
          <p className="text-2xl font-bold">{formatRate(totalOut)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Error Rate</p>
          <p className="text-2xl font-bold">{Math.max(0, errorRate).toFixed(1)}%</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Components</p>
          <p className="text-2xl font-bold">{entries.length}</p>
        </CardContent>
      </Card>
    </div>
  );
}
