"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

const statusColors: Record<string, string> = {
  HEALTHY: "bg-green-500/15 text-green-700 dark:text-green-400",
  DEGRADED: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  UNREACHABLE: "bg-red-500/15 text-red-700 dark:text-red-400",
  UNKNOWN: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

function relativeTime(date: Date | string | null): string {
  if (!date) return "Never";
  const ms = Date.now() - new Date(date).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtRate(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M/s`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K/s`;
  if (n >= 1) return `${n.toFixed(1)}/s`;
  if (n > 0) return `${n.toFixed(2)}/s`;
  return "0/s";
}

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

function fmtBytesRate(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB/s`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB/s`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB/s`;
  return `${Math.round(n)} B/s`;
}

interface NodeCardProps {
  node: {
    id: string;
    name: string;
    host: string;
    status: string;
    lastSeen: Date | string | null;
    environment: { id: string; name: string };
    pipelineCount: number;
    unhealthyPipelines: number;
    rates: {
      eventsIn: number;
      eventsOut: number;
      bytesIn: number;
      bytesOut: number;
      errors: number;
    };
    totals: {
      eventsIn: number;
      eventsOut: number;
      bytesIn: number;
      bytesOut: number;
      errors: number;
    };
    sparkline: Array<{ t: number; mem: number; cpu: number }>;
  };
}

export function NodeCard({ node }: NodeCardProps) {
  const cpuData = node.sparkline.map((s) => s.cpu);
  const memData = node.sparkline.map((s) => s.mem);

  const healthyCount = node.pipelineCount - node.unhealthyPipelines;
  const pipelineLabel =
    node.unhealthyPipelines === 0
      ? `${node.pipelineCount} pipelines running`
      : `${healthyCount} of ${node.pipelineCount} running`;

  return (
    <Link href={`/fleet/${node.id}`} className="block">
      <Card className="cursor-pointer transition-colors hover:border-foreground/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">{node.name}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                {node.environment.name}
              </Badge>
              <Badge className={cn("text-xs px-1.5 py-0", statusColors[node.status] ?? statusColors.UNKNOWN)}>
                {node.status}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground truncate">{node.host}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Sparklines */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>CPU</span>
              <Sparkline data={cpuData} color="#3b82f6" />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Mem</span>
              <Sparkline data={memData} color="#22c55e" />
            </div>
          </div>

          {/* Pipeline health */}
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                node.unhealthyPipelines > 0 ? "bg-yellow-500" : "bg-green-500"
              )}
            />
            <span className="text-muted-foreground">{pipelineLabel}</span>
          </div>

          {/* Live rates */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Events in</span>
              <span className="font-mono">{fmtRate(node.rates.eventsIn)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Events out</span>
              <span className="font-mono">{fmtRate(node.rates.eventsOut)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bytes in</span>
              <span className="font-mono">{fmtBytesRate(node.rates.bytesIn)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bytes out</span>
              <span className="font-mono">{fmtBytesRate(node.rates.bytesOut)}</span>
            </div>
          </div>

          {/* Cumulative totals */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Total in</span>
              <span className="font-mono">{fmtCount(node.totals.eventsIn)}</span>
            </div>
            <div className="flex justify-between">
              <span>Total out</span>
              <span className="font-mono">{fmtCount(node.totals.eventsOut)}</span>
            </div>
          </div>

          {/* Errors (only if > 0) */}
          {(node.rates.errors > 0 || node.totals.errors > 0) && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-red-500" />
              <span className="text-red-600 dark:text-red-400 font-medium">
                {node.rates.errors > 0 ? fmtRate(node.rates.errors) : `${fmtCount(node.totals.errors)} total`} errors
              </span>
            </div>
          )}

          {/* Last seen */}
          <p className="text-xs text-muted-foreground text-right">
            Seen {relativeTime(node.lastSeen)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
