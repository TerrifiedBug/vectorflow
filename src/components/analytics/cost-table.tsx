// src/components/analytics/cost-table.tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PipelineCostRow } from "@/server/services/cost-attribution";

type SortKey = "pipelineName" | "teamName" | "environmentName" | "bytesIn" | "bytesOut" | "reductionPercent" | "costCents";
type SortDir = "asc" | "desc";

interface CostTableProps {
  rows: PipelineCostRow[];
  isLoading: boolean;
}

function formatCost(cents: number): string {
  if (cents === 0) return "--";
  return `$${(cents / 100).toFixed(2)}`;
}

export function CostTable({ rows, isLoading }: CostTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("bytesIn");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  const sorted = [...rows].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortDir === "asc"
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number);
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Per-Pipeline Cost Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            No pipeline data for selected time range
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {([
                    ["pipelineName", "Pipeline"],
                    ["teamName", "Team"],
                    ["environmentName", "Environment"],
                    ["bytesIn", "Bytes In"],
                    ["bytesOut", "Bytes Out"],
                    ["reductionPercent", "Reduction %"],
                    ["costCents", "Est. Cost"],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <TableHead key={key} className={cn("select-none", key !== "pipelineName" && "text-right")}>
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer",
                          key !== "pipelineName" && "ml-auto"
                        )}
                        aria-label={`Sort by ${label}${sortKey === key ? `, currently ${sortDir === "asc" ? "ascending" : "descending"}` : ""}`}
                      >
                        {label}{sortIndicator(key)}
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow key={r.pipelineId}>
                    <TableCell className="font-medium">{r.pipelineName}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.teamName}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.environmentName}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatBytes(r.bytesIn)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatBytes(r.bytesOut)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-[width] duration-300",
                              r.reductionPercent >= 50
                                ? "bg-green-500"
                                : r.reductionPercent >= 20
                                  ? "bg-amber-500"
                                  : "bg-red-400"
                            )}
                            style={{ width: `${Math.max(0, Math.min(100, r.reductionPercent))}%` }}
                          />
                        </div>
                        <span className="font-mono text-sm tabular-nums w-14 text-right">
                          {r.reductionPercent.toFixed(1)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCost(r.costCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
