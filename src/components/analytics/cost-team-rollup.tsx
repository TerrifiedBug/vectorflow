// src/components/analytics/cost-team-rollup.tsx
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
import type { TeamCostRow } from "@/server/services/cost-attribution";

interface CostTeamRollupProps {
  rows: TeamCostRow[];
  isLoading: boolean;
}

function formatCost(cents: number): string {
  if (cents === 0) return "--";
  return `$${(cents / 100).toFixed(2)}`;
}

export function CostTeamRollup({ rows, isLoading }: CostTeamRollupProps) {
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
        <CardTitle className="text-sm font-medium">Team Cost Rollup (Chargeback)</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            No team data available
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Pipelines</TableHead>
                  <TableHead className="text-right">Bytes In</TableHead>
                  <TableHead className="text-right">Bytes Out</TableHead>
                  <TableHead className="text-right">Est. Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow key={r.teamId}>
                    <TableCell className="font-medium">{r.teamName}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.pipelineCount}
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
