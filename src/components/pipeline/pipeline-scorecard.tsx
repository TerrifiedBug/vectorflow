"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Activity,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  Bell,
  Lightbulb,
} from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import {
  formatBytes,
  formatLastSeen,
  formatPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";

interface PipelineScorecardProps {
  pipelineId: string;
}

type HealthStatus = "healthy" | "degraded" | "no_data";

function healthBorder(status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return "border-l-4 border-l-green-500";
    case "degraded":
      return "border-l-4 border-l-destructive";
    default:
      return "border-l-4 border-l-muted";
  }
}

function healthIcon(status: HealthStatus) {
  switch (status) {
    case "healthy":
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case "degraded":
      return <AlertTriangle className="h-5 w-5 text-destructive" />;
    default:
      return <Activity className="h-5 w-5 text-muted-foreground" />;
  }
}

function trendIcon(ratio: number | null | undefined, lowerIsBetter: boolean) {
  if (ratio === null || ratio === undefined || !isFinite(ratio)) {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  if (Math.abs(ratio - 1) < 0.05) {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  const trendingUp = ratio > 1;
  const isBad = lowerIsBetter ? trendingUp : !trendingUp;
  const colorClass = isBad ? "text-destructive" : "text-green-500";
  const Icon = trendingUp ? TrendingUp : TrendingDown;
  return <Icon className={cn("h-3.5 w-3.5", colorClass)} />;
}

function formatDelta(percent: number | null): string {
  if (percent === null) return "—";
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(1)}%`;
}

function severityBadgeVariant(
  severity: string | null,
): "destructive" | "secondary" | "outline" {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "secondary";
  return "outline";
}

export function PipelineScorecard({ pipelineId }: PipelineScorecardProps) {
  const trpc = useTRPC();
  const query = useQuery({
    ...trpc.pipeline.scorecard.queryOptions({ pipelineId }),
    refetchInterval: 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <QueryError
        message="Failed to load scorecard"
        onRetry={() => query.refetch()}
      />
    );
  }

  const data = query.data;
  const health = data.health as { status: HealthStatus; slis: Array<{ metric: string; status: string; value: number | null; threshold: number; condition: string }> };

  return (
    <div className="space-y-4">
      <Card className={cn(healthBorder(health.status))}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              {healthIcon(health.status)}
              <div>
                <CardTitle className="text-base">{data.pipeline.name}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {data.pipeline.isDraft
                    ? "Draft — not deployed"
                    : data.pipeline.deployedAt
                      ? `Deployed ${formatLastSeen(data.pipeline.deployedAt)}`
                      : "Never deployed"}
                </p>
              </div>
            </div>
            <Badge
              variant={
                health.status === "healthy"
                  ? "outline"
                  : health.status === "degraded"
                    ? "destructive"
                    : "secondary"
              }
              className="capitalize"
            >
              {health.status === "no_data" ? "No SLIs configured" : health.status}
            </Badge>
          </div>
        </CardHeader>
        {health.slis.length > 0 && (
          <CardContent className="pt-0">
            <ul className="space-y-1.5">
              {health.slis.map((sli) => (
                <li
                  key={sli.metric}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="font-mono">{sli.metric}</span>
                  <span
                    className={cn(
                      "tabular-nums",
                      sli.status === "breached"
                        ? "text-destructive"
                        : sli.status === "met"
                          ? "text-green-600 dark:text-green-400"
                          : "text-muted-foreground",
                    )}
                  >
                    {sli.value === null
                      ? "no data"
                      : `${sli.value.toFixed(3)} (${sli.condition} ${sli.threshold})`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      {data.recommendedAction && (
        <Card className="border-l-4 border-l-blue-500 bg-blue-50/40 dark:bg-blue-950/20">
          <CardContent className="py-3 flex items-start gap-2">
            <Lightbulb className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Recommended next action</p>
              <p className="text-muted-foreground">
                {data.recommendedAction.message}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Bell className="h-3.5 w-3.5" />
              Active alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {data.alerts.firingCount}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.alerts.firingCount === 0
                ? "No firing alerts"
                : "Currently firing"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Open anomalies
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-semibold tabular-nums">
                {data.anomalies.openCount}
              </p>
              {data.anomalies.maxSeverity && (
                <Badge
                  variant={severityBadgeVariant(data.anomalies.maxSeverity)}
                  className="capitalize"
                >
                  {data.anomalies.maxSeverity}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.anomalies.openCount === 0
                ? "No anomalies detected"
                : "Awaiting review"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              Cost (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {(data.cost.last24h.costCents / 100).toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
              })}
            </p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              {trendIcon(
                data.cost.deltaPercent === null
                  ? null
                  : 1 + data.cost.deltaPercent / 100,
                true,
              )}
              {formatDelta(data.cost.deltaPercent)} vs prior 24h
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Trend (current 24h vs trailing 7d)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Error rate</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-lg font-semibold tabular-nums">
                {data.trend.errorRate?.current === null ||
                data.trend.errorRate?.current === undefined
                  ? "—"
                  : formatPercent(data.trend.errorRate.current * 100)}
              </p>
              {trendIcon(data.trend.errorRate?.deltaRatio ?? null, true)}
              <span className="text-xs text-muted-foreground tabular-nums">
                {data.trend.errorRate?.deltaRatio == null
                  ? ""
                  : `${data.trend.errorRate.deltaRatio.toFixed(2)}× baseline`}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Throughput</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-lg font-semibold tabular-nums">
                {data.trend.throughput.currentEventsPerSec.toFixed(1)} ev/s
              </p>
              {trendIcon(data.trend.throughput.deltaRatio ?? null, false)}
              <span className="text-xs text-muted-foreground tabular-nums">
                {data.trend.throughput.deltaRatio == null
                  ? ""
                  : `${data.trend.throughput.deltaRatio.toFixed(2)}× baseline`}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {data.recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Cost recommendations ({data.recommendations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.recommendations.map((rec) => (
                <li
                  key={rec.id}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{rec.title}</p>
                    <p className="text-xs text-muted-foreground">{rec.type}</p>
                  </div>
                  {rec.estimatedSavingsBytes !== null && (
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      ~{formatBytes(rec.estimatedSavingsBytes)}/day saved
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
