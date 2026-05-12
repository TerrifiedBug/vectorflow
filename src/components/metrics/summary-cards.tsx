"use client";

import { Card, CardContent } from "@/components/ui/card";

interface MetricRow {
  timestamp: Date;
  eventsIn: bigint;
  eventsOut: bigint;
  errorsTotal: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  eventsDiscarded: bigint;
}

interface SummaryCardsProps {
  rows: MetricRow[];
}

function formatRate(perSec: number): string {
  if (perSec >= 1_000_000) return `${(perSec / 1_000_000).toFixed(1)}M/s`;
  if (perSec >= 1_000) return `${(perSec / 1_000).toFixed(1)}K/s`;
  if (perSec >= 1) return `${perSec.toFixed(1)}/s`;
  return `${perSec.toFixed(2)}/s`;
}

function formatBytes(perSec: number): string {
  if (perSec >= 1_073_741_824) return `${(perSec / 1_073_741_824).toFixed(1)} GB/s`;
  if (perSec >= 1_048_576) return `${(perSec / 1_048_576).toFixed(1)} MB/s`;
  if (perSec >= 1_024) return `${(perSec / 1_024).toFixed(1)} KB/s`;
  return `${Math.round(perSec)} B/s`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function bucketSecondsAt(rows: MetricRow[], index: number): number {
  const current = new Date(rows[index]!.timestamp).getTime();
  const prev = rows[index - 1] ? new Date(rows[index - 1]!.timestamp).getTime() : 0;
  if (current > prev) return (current - prev) / 1000;

  const next = rows[index + 1] ? new Date(rows[index + 1]!.timestamp).getTime() : 0;
  if (next > current) return (next - current) / 1000;

  return 60;
}

export function SummaryCards({ rows }: SummaryCardsProps) {
  // Use the latest row for "current" rates
  const latest = rows.length > 0 ? rows[rows.length - 1] : null;
  const latestBucketSeconds = latest ? bucketSecondsAt(rows, rows.length - 1) : 60;
  const eventsInRate = latest ? Number(latest.eventsIn) / latestBucketSeconds : 0;
  const eventsOutRate = latest ? Number(latest.eventsOut) / latestBucketSeconds : 0;
  const bytesInRate = latest ? Number(latest.bytesIn) / latestBucketSeconds : 0;
  const errorsTotal = rows.reduce((sum, r) => sum + Number(r.errorsTotal), 0);
  const discardedTotal = rows.reduce((sum, r) => sum + Number(r.eventsDiscarded), 0);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Events In</p>
          <p className="text-2xl font-bold tabular-nums">{formatRate(eventsInRate)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Events Out</p>
          <p className="text-2xl font-bold tabular-nums">{formatRate(eventsOutRate)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Data In</p>
          <p className="text-2xl font-bold tabular-nums">{formatBytes(bytesInRate)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Errors</p>
          <p className="text-2xl font-bold tabular-nums">{formatCount(errorsTotal)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Discarded</p>
          <p className="text-2xl font-bold tabular-nums">{formatCount(discardedTotal)}</p>
        </CardContent>
      </Card>
    </div>
  );
}
