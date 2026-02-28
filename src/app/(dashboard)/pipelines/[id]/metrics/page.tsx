"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryCards } from "@/components/metrics/summary-cards";
import { ComponentChart } from "@/components/metrics/component-chart";

const TIME_RANGES = [
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
] as const;

export default function PipelineMetricsPage() {
  const params = useParams<{ id: string }>();
  const trpc = useTRPC();
  const [minutes, setMinutes] = useState(15);

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
  const metricsData = metricsQuery.data?.components ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {pipeline?.name ?? "Pipeline"} — Metrics
          </h2>
          <p className="text-muted-foreground">
            Real-time throughput and component performance
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

      <SummaryCards allSamples={metricsData} />

      <Card>
        <CardHeader>
          <CardTitle>Components</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(metricsData).length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground">
                No metrics data available yet. Metrics appear after the pipeline
                is deployed and the fleet poller begins collecting data.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(metricsData).map(([componentId, data]) => (
                <div key={componentId} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{data.componentKey}</span>
                    <span className="text-xs text-muted-foreground">
                      {data.componentType} ({data.kind})
                    </span>
                  </div>
                  <ComponentChart samples={data.samples} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
