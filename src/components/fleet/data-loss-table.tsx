"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { formatCount, formatPercent } from "@/lib/format";

interface PipelineDataLoss {
  pipelineId: string;
  pipelineName: string;
  eventsIn: number;
  eventsOut: number;
  eventsDiscarded: number;
  lossRate: number;
}

interface DataLossTableProps {
  data: PipelineDataLoss[] | undefined;
  isLoading: boolean;
  threshold: number;
  onThresholdChange: (value: number) => void;
}

export function DataLossTable({
  data,
  isLoading,
  threshold,
  onThresholdChange,
}: DataLossTableProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  const thresholdPct = Math.round(threshold * 100);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-semibold">Data Loss Detection</CardTitle>
          {data && data.length > 0 ? (
            <Badge variant="destructive" className="text-xs">
              {data.length} flagged
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400 border-green-500/50">
              No loss detected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Threshold
          </span>
          <Input
            type="number"
            value={thresholdPct}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1 && v <= 50) onThresholdChange(v / 100);
            }}
            className="h-7 w-14 text-xs text-center"
            min={1}
            max={50}
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
      </CardHeader>
      <CardContent>
        {!data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
            <p className="text-sm text-muted-foreground">
              No pipelines exceed the {thresholdPct}% loss threshold
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Pipeline</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Events In</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Events Out</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Loss Rate</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.map((row) => {
                  const severity = row.lossRate >= 0.2 ? "critical" : row.lossRate >= 0.1 ? "warning" : "minor";
                  return (
                    <tr
                      key={row.pipelineId}
                      className={`transition-colors hover:bg-muted/50 ${
                        severity === "critical"
                          ? "bg-red-50/50 dark:bg-red-950/10"
                          : severity === "warning"
                            ? "bg-orange-50/50 dark:bg-orange-950/10"
                            : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-medium">
                        <Link
                          href={`/pipelines/${row.pipelineId}`}
                          className="hover:underline"
                        >
                          {row.pipelineName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCount(row.eventsIn)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCount(row.eventsOut)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-red-600 dark:text-red-400">
                        {formatPercent(row.lossRate)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center">
                          <AlertTriangle
                            className={`h-4 w-4 ${
                              severity === "critical"
                                ? "text-red-500"
                                : severity === "warning"
                                  ? "text-orange-500"
                                  : "text-yellow-500"
                            }`}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
