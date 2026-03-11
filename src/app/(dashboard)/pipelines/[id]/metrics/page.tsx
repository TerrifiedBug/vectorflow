"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryCards } from "@/components/metrics/summary-cards";
import { MetricsChart } from "@/components/metrics/component-chart";
import { PipelineLogs } from "@/components/pipeline/pipeline-logs";

const TIME_RANGES = [
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
] as const;

export default function PipelineMetricsPage() {
  const params = useParams<{ id: string }>();
  const trpc = useTRPC();
  const [minutes, setMinutes] = useState(60);

  const pipelineQuery = useQuery(
    trpc.pipeline.get.queryOptions({ id: params.id }),
  );

  const metricsQuery = useQuery(
    trpc.metrics.getPipelineMetrics.queryOptions(
      { pipelineId: params.id, minutes },
      { refetchInterval: 15000 },
    ),
  );

  if (pipelineQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    );
  }

  const pipeline = pipelineQuery.data;
  const rows = metricsQuery.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {pipeline?.name ?? "Pipeline"} — Metrics
          </h2>
          <p className="text-muted-foreground">
            Pipeline throughput and performance
          </p>
        </div>
        <div className="flex gap-1">
          {TIME_RANGES.map((tr) => (
            <Button
              key={tr.label}
              variant={minutes === tr.minutes ? "default" : "outline"}
              size="sm"
              onClick={() => setMinutes(tr.minutes)}
            >
              {tr.label}
            </Button>
          ))}
        </div>
      </div>

      <SummaryCards rows={rows} />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground">
                No metrics data available yet. Metrics appear after the pipeline
                is deployed and agents begin reporting heartbeats.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Events Throughput</CardTitle>
            </CardHeader>
            <CardContent>
              <MetricsChart rows={rows} dataKey="events" height={220} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data Throughput</CardTitle>
            </CardHeader>
            <CardContent>
              <MetricsChart rows={rows} dataKey="bytes" height={220} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Errors & Discarded Events</CardTitle>
            </CardHeader>
            <CardContent>
              <MetricsChart rows={rows} dataKey="errors" height={220} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Component Latency</CardTitle>
            </CardHeader>
            <CardContent>
              <MetricsChart rows={rows} dataKey="latency" height={220} />
            </CardContent>
          </Card>
        </>
      )}

      {/* Pipeline Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[400px]">
            <PipelineLogs pipelineId={params.id} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
