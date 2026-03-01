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

const pipelineStatusDot: Record<string, string> = {
  RUNNING: "bg-green-500",
  STARTING: "bg-blue-500",
  STOPPED: "bg-gray-400",
  CRASHED: "bg-red-500",
  PENDING: "bg-yellow-500",
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

interface NodeCardProps {
  node: {
    id: string;
    name: string;
    host: string;
    status: string;
    lastSeen: Date | string | null;
    environment: { id: string; name: string };
    pipelines: Array<{
      id: string;
      name: string;
      status: string;
      eventsIn: number;
      eventsOut: number;
      bytesIn: number;
      bytesOut: number;
    }>;
    sparkline: Array<{ t: number; mem: number; cpu: number }>;
  };
}

export function NodeCard({ node }: NodeCardProps) {
  const cpuData = node.sparkline.map((s) => s.cpu);
  const memData = node.sparkline.map((s) => s.mem);

  return (
    <Link href={`/fleet/${node.id}`} className="block">
      <Card className="transition-colors hover:border-foreground/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">{node.name}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {node.environment.name}
              </Badge>
              <Badge className={cn("text-[10px] px-1.5 py-0", statusColors[node.status] ?? statusColors.UNKNOWN)}>
                {node.status}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground truncate">{node.host}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Sparklines */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>CPU</span>
              <Sparkline data={cpuData} color="#3b82f6" />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>Mem</span>
              <Sparkline data={memData} color="#22c55e" />
            </div>
          </div>

          {/* Pipeline list */}
          {node.pipelines.length > 0 && (
            <div className="space-y-1">
              {node.pipelines.slice(0, 4).map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", pipelineStatusDot[p.status] ?? "bg-gray-400")} />
                    <span className="truncate">{p.name}</span>
                  </div>
                  <span className="font-mono text-muted-foreground text-[10px] shrink-0 ml-2">
                    {p.eventsIn}/{p.eventsOut} ev/s
                  </span>
                </div>
              ))}
              {node.pipelines.length > 4 && (
                <p className="text-[10px] text-muted-foreground">+{node.pipelines.length - 4} more</p>
              )}
            </div>
          )}

          {/* Last seen */}
          <p className="text-[10px] text-muted-foreground text-right">
            Seen {relativeTime(node.lastSeen)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
