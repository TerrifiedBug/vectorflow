"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCount, formatBytes, formatBytesRate } from "@/lib/format";
import { Sparkline } from "./sparkline";

const pipelineStatusDot: Record<string, string> = {
  RUNNING: "bg-green-500",
  STARTING: "bg-blue-500",
  STOPPED: "bg-gray-400",
  CRASHED: "bg-red-500",
  PENDING: "bg-yellow-500",
};

const nodeStatusDot: Record<string, string> = {
  HEALTHY: "bg-green-500",
  DEGRADED: "bg-yellow-500",
  UNREACHABLE: "bg-red-500",
  UNKNOWN: "bg-gray-400",
};

/** Format an events-per-second rate with /s suffix for display. */
function fmtRate(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M/s`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K/s`;
  if (n >= 1) return `${n.toFixed(1)}/s`;
  if (n > 0) return `${n.toFixed(2)}/s`;
  return "0/s";
}

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

interface PipelineCardProps {
  pipeline: {
    id: string;
    name: string;
    environment: { id: string; name: string };
    deployedAt: Date | string | null;
    latestVersion: number;
    nodes: Array<{
      id: string;
      name: string;
      status: string;
      pipelineStatus: string;
    }>;
    rates: { eventsIn: number; eventsOut: number; bytesIn: number; bytesOut: number; errors: number };
    totals: { eventsIn: number; eventsOut: number; bytesIn: number; bytesOut: number; errors: number };
    sparkline: Array<{ t: number; eventsIn: number; eventsOut: number }>;
  };
}

export function PipelineCard({ pipeline }: PipelineCardProps) {
  const eventsData = pipeline.sparkline.map((s) => s.eventsIn + s.eventsOut);
  const { rates, totals } = pipeline;

  return (
    <Link href={`/pipelines/${pipeline.id}`} className="block">
      <Card className="transition-colors hover:border-foreground/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm truncate">{pipeline.name}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {pipeline.environment.name}
              </Badge>
              {pipeline.latestVersion > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  v{pipeline.latestVersion}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Live rates + sparkline */}
          <div className="flex items-center justify-between">
            <div className="text-xs space-y-0.5">
              <p className="text-muted-foreground">
                <span className="font-mono text-foreground">{fmtRate(rates.eventsIn)}</span> in / <span className="font-mono text-foreground">{fmtRate(rates.eventsOut)}</span> out
              </p>
              <p className="text-muted-foreground">
                {formatBytesRate(rates.bytesIn)} in / {formatBytesRate(rates.bytesOut)} out
              </p>
            </div>
            <Sparkline data={eventsData} color="#8b5cf6" />
          </div>

          {/* Cumulative totals */}
          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <p>Total: {formatCount(totals.eventsIn)} in / {formatCount(totals.eventsOut)} out events</p>
            <p>Total: {formatBytes(totals.bytesIn)} in / {formatBytes(totals.bytesOut)} out</p>
          </div>

          {/* Errors */}
          {(rates.errors > 0 || totals.errors > 0) && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-red-500" />
              <span className="text-red-600 dark:text-red-400 font-medium">
                {rates.errors > 0 ? `${rates.errors.toFixed(1)}/s` : formatCount(totals.errors)} errors
              </span>
            </div>
          )}

          {/* Nodes list */}
          {pipeline.nodes.length > 0 && (
            <div className="space-y-1">
              {pipeline.nodes.slice(0, 4).map((n) => (
                <div key={n.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", nodeStatusDot[n.status] ?? "bg-gray-400")} />
                    <span className="truncate">{n.name}</span>
                  </div>
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", pipelineStatusDot[n.pipelineStatus] ?? "bg-gray-400")} />
                </div>
              ))}
              {pipeline.nodes.length > 4 && (
                <p className="text-[10px] text-muted-foreground">+{pipeline.nodes.length - 4} more</p>
              )}
            </div>
          )}

          {/* Deploy info */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{pipeline.nodes.length} node{pipeline.nodes.length !== 1 ? "s" : ""}</span>
            <span>Deployed {relativeTime(pipeline.deployedAt)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
