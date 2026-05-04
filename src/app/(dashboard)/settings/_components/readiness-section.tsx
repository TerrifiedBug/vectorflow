"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  RefreshCw,
  ExternalLink,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";

type SignalStatus = "ok" | "warn" | "error" | "unknown";

function StatusIcon({ status }: { status: SignalStatus }) {
  switch (status) {
    case "ok":
      return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
    case "warn":
      return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
    case "error":
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    default:
      return <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function OverallBadge({ status }: { status: SignalStatus }) {
  switch (status) {
    case "ok":
      return <Badge className="bg-green-600 text-white border-transparent">All clear</Badge>;
    case "warn":
      return <Badge variant="outline" className="text-yellow-600 border-yellow-500">Needs attention</Badge>;
    case "error":
      return <Badge variant="destructive">Issues detected</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
}

export function ReadinessSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const query = useQuery(
    trpc.settings.productionReadiness.queryOptions(undefined, {
      staleTime: 60 * 1000,
      refetchInterval: false,
    }),
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: trpc.settings.productionReadiness.queryKey(),
      });
      await queryClient.refetchQueries({
        queryKey: trpc.settings.productionReadiness.queryKey(),
      });
    } catch {
      toast.error("Failed to refresh readiness status");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Production Readiness</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Aggregated health and configuration signals for this VectorFlow instance.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing || query.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {query.error && <QueryError message="Failed to load readiness status" onRetry={handleRefresh} />}

      {query.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {query.data && (
        <>
          <div className="flex items-center gap-3">
            <OverallBadge status={query.data.overallStatus} />
            <span className="text-xs text-muted-foreground">
              Checked {new Date(query.data.checkedAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="space-y-2">
            {query.data.signals.map((signal) => (
              <Card key={signal.id} className="py-3">
                <CardContent className="px-4 py-0">
                  <div className="flex items-center gap-3">
                    <StatusIcon status={signal.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{signal.label}</span>
                        {signal.href && (
                          <Link
                            href={signal.href}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{signal.detail}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
