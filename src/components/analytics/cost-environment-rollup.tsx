// src/components/analytics/cost-environment-rollup.tsx
"use client";

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
import type { EnvironmentCostRow } from "@/server/services/cost-attribution";

interface CostEnvironmentRollupProps {
  rows: EnvironmentCostRow[];
  isLoading: boolean;
}

function formatCost(cents: number): string {
  if (cents === 0) return "--";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatRate(cents: number): string {
  if (cents === 0) return "Not configured";
  return `$${(cents / 100).toFixed(2)}/GB`;
}

export function CostEnvironmentRollup({ rows, isLoading }: CostEnvironmentRollupProps) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  const sorted = [...rows].sort((a, b) => b.bytesIn - a.bytesIn);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Environment Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            No environment data available
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Environment</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Bytes In</TableHead>
                  <TableHead className="text-right">Bytes Out</TableHead>
                  <TableHead className="text-right">Est. Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow key={r.environmentId}>
                    <TableCell className="font-medium">{r.environmentName}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRate(r.costPerGbCents)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatBytes(r.bytesIn)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatBytes(r.bytesOut)}
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
