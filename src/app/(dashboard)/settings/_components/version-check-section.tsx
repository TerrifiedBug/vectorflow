"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Relative Time Helper ───────────────────────────────────────────────────────

function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ─── Version Check Section ──────────────────────────────────────────────────────

export function VersionCheckSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [isChecking, setIsChecking] = useState(false);

  const versionQuery = useQuery(
    trpc.settings.checkVersion.queryOptions(undefined, {
      refetchInterval: false,
      staleTime: Infinity,
    }),
  );

  const handleCheckNow = async () => {
    setIsChecking(true);
    try {
      await queryClient.fetchQuery(
        trpc.settings.checkVersion.queryOptions({ force: true }, { staleTime: 0 }),
      );
      // Invalidate to pick up the fresh data
      await queryClient.invalidateQueries({
        queryKey: trpc.settings.checkVersion.queryKey(),
      });
    } catch {
      toast.error("Failed to check for updates");
    } finally {
      setIsChecking(false);
    }
  };

  const server = versionQuery.data?.server;
  const agent = versionQuery.data?.agent;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Version Information</CardTitle>
            <CardDescription>
              Current and latest versions of VectorFlow components
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckNow}
            disabled={isChecking || versionQuery.isLoading}
          >
            {isChecking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Check now
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {versionQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-48" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Server version */}
            <div className="grid grid-cols-[140px_1fr] items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">Server version</span>
              <span className="font-mono">{server?.currentVersion ?? "unknown"}</span>

              <span className="text-muted-foreground">Latest server</span>
              <div className="flex items-center gap-2">
                <span className="font-mono">
                  {server?.latestVersion ?? "unknown"}
                </span>
                {server?.updateAvailable && (
                  <Badge variant="secondary" className="text-xs">
                    Update available
                  </Badge>
                )}
                {server?.latestVersion &&
                  !server.updateAvailable &&
                  server.currentVersion !== "dev" && (
                    <Badge
                      variant="outline"
                      className="text-xs text-green-600 border-green-600"
                    >
                      Up to date
                    </Badge>
                  )}
                {server?.releaseUrl && (
                  <a
                    href={server.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Release notes
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            <Separator />

            {/* Agent version */}
            <div className="grid grid-cols-[140px_1fr] items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">Latest agent</span>
              <span className="font-mono">
                {agent?.latestVersion ?? "unknown"}
              </span>
            </div>

            <Separator />

            {/* Last checked */}
            <p className="text-xs text-muted-foreground">
              Last checked: {formatRelativeTime(server?.checkedAt)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
