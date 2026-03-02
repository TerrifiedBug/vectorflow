"use client";

import { Card, CardContent } from "@/components/ui/card";

interface MetricRow {
  eventsIn: bigint;
  eventsOut: bigint;
  errorsTotal: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
}

interface SummaryCardsProps {
  rows: MetricRow[];
}

function formatRate(perMin: number): string {
  const perSec = perMin / 60;
  if (perSec >= 1_000_000) return `${(perSec / 1_000_000).toFixed(1)}M/s`;
  if (perSec >= 1_000) return `${(perSec / 1_000).toFixed(1)}K/s`;
  if (perSec >= 1) return `${perSec.toFixed(1)}/s`;
  return `${perSec.toFixed(2)}/s`;
}

function formatBytes(perMin: number): string {
  const perSec = perMin / 60;
  if (perSec >= 1_073_741_824) return `${(perSec / 1_073_741_824).toFixed(1)} GB/s`;
  if (perSec >= 1_048_576) return `${(perSec / 1_048_576).toFixed(1)} MB/s`;
  if (perSec >= 1_024) return `${(perSec / 1_024).toFixed(1)} KB/s`;
  return `${Math.round(perSec)} B/s`;
}

export function SummaryCards({ rows }: SummaryCardsProps) {
  // Use the latest row for "current" rates
  const latest = rows.length > 0 ? rows[rows.length - 1] : null;
  const eventsInRate = latest ? Number(latest.eventsIn) : 0;
  const eventsOutRate = latest ? Number(latest.eventsOut) : 0;
  const bytesInRate = latest ? Number(latest.bytesIn) : 0;
  const errorsTotal = rows.reduce((sum, r) => sum + Number(r.errorsTotal), 0);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Events In</p>
          <p className="text-2xl font-bold">{formatRate(eventsInRate)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Events Out</p>
          <p className="text-2xl font-bold">{formatRate(eventsOutRate)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Data In</p>
          <p className="text-2xl font-bold">{formatBytes(bytesInRate)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Errors</p>
          <p className="text-2xl font-bold">{errorsTotal}</p>
        </CardContent>
      </Card>
    </div>
  );
}
