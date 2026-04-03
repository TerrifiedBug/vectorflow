"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useLiveTap } from "@/hooks/use-live-tap";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, ChevronDown, ChevronRight, Square, Radio } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────

interface LiveTailPanelProps {
  pipelineId: string;
  componentKey: string;
  isDeployed: boolean;
}

interface MergedEvent {
  id: string | number;
  data: unknown;
  source: "sample" | "tap";
}

// ── Component ───────────────────────────────────────────────────────

export function LiveTailPanel({ pipelineId, componentKey, isDeployed }: LiveTailPanelProps) {
  const trpc = useTRPC();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [sampleEvents, setSampleEvents] = useState<Array<{ id: number; data: unknown }>>([]);
  const [hasExpired, setHasExpired] = useState(false);
  const [completedEmpty, setCompletedEmpty] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string | number>>(new Set());

  const sampleCounterRef = useRef(0);

  // Track which requestId we've already processed to avoid double-processing
  const processedRequestRef = useRef<string | null>(null);

  // Live tap hook
  const liveTap = useLiveTap({ pipelineId, componentId: componentKey });

  // Reset events and any in-flight request when the selected component changes
  const [prevComponentKey, setPrevComponentKey] = useState(componentKey);
  if (prevComponentKey !== componentKey) {
    setPrevComponentKey(componentKey);
    setSampleEvents([]);
    setRequestId(null);
    setHasExpired(false);
    setCompletedEmpty(false);
    setExpandedIds(new Set());
  }

  const processResults = useCallback((data: { status: string; samples?: Array<{ componentKey: string; events: unknown }> }) => {
    if (!requestId || processedRequestRef.current === requestId) return;
    if (data.status !== "COMPLETED" || !data.samples) {
      if (data.status === "EXPIRED") {
        setHasExpired(true);
        processedRequestRef.current = requestId;
        setRequestId(null); // allow clean re-sample
      }
      return;
    }

    const newEvents = data.samples
      .filter((s) => s.componentKey === componentKey)
      .flatMap((s) => {
        const evts = (s.events as unknown[]) ?? [];
        return evts.map((e) => ({
          id: sampleCounterRef.current++,
          data: e,
        }));
      });

    if (newEvents.length > 0) {
      setSampleEvents((prev) => [...newEvents, ...prev].slice(0, 50));
      setCompletedEmpty(false);
    } else {
      setCompletedEmpty(true);
    }

    processedRequestRef.current = requestId;
    setRequestId(null); // Stop polling
  }, [requestId, componentKey]);

  // Request samples mutation
  const requestMutation = useMutation(
    trpc.pipeline.requestSamples.mutationOptions({
      onSuccess: (result) => {
        setRequestId(result.requestId);
      },
    })
  );

  // Poll for results when we have a requestId
  const resultQuery = useQuery({
    ...trpc.pipeline.sampleResult.queryOptions({ requestId: requestId! }),
    enabled: !!requestId,
    select: (data) => {
      // Process results via select callback (not in an effect)
      processResults(data);
      return data;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "COMPLETED" || data?.status === "ERROR" || data?.status === "EXPIRED") return false;
      return 1000; // Poll every second while pending
    },
  });

  const handleSample = useCallback(() => {
    processedRequestRef.current = null;
    setRequestId(null);
    setHasExpired(false);
    setCompletedEmpty(false);
    requestMutation.mutate({
      pipelineId,
      componentKeys: [componentKey],
      limit: 10,
    });
  }, [pipelineId, componentKey, requestMutation]);

  const toggleExpand = useCallback((id: string | number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (!isDeployed) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Pipeline must be deployed to sample live events.
      </div>
    );
  }

  const isPending = requestMutation.isPending || (!!requestId && (resultQuery.isFetching || resultQuery.data?.status === "PENDING"));

  // Merge tap events (newest first) then sample events (newest first)
  const mergedEvents: MergedEvent[] = [
    ...liveTap.events.map((e) => ({ id: e.id, data: e.data, source: "tap" as const })),
    ...sampleEvents.map((e) => ({ id: e.id, data: e.data, source: "sample" as const })),
  ];

  const hasNoEvents = mergedEvents.length === 0;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Live Events</span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={handleSample}
            disabled={isPending}
            className="h-7 gap-1.5 text-xs"
          >
            {isPending ? (
              <><Loader2 className="h-3 w-3 animate-spin" />Sampling...</>
            ) : (
              <><Play className="h-3 w-3" />Sample 10</>
            )}
          </Button>
          {!liveTap.isActive && !liveTap.isStarting && (
            <Button
              size="sm"
              variant="outline"
              onClick={liveTap.start}
              className="h-7 gap-1.5 text-xs"
            >
              <Radio className="h-3 w-3" />Live Tap
            </Button>
          )}
          {liveTap.isStarting && (
            <Button
              size="sm"
              variant="outline"
              disabled
              className="h-7 gap-1.5 text-xs"
            >
              <Loader2 className="h-3 w-3 animate-spin" />Starting...
            </Button>
          )}
          {liveTap.isActive && (
            <Button
              size="sm"
              variant="destructive"
              onClick={liveTap.stop}
              className="h-7 gap-1.5 text-xs"
            >
              <Square className="h-3 w-3" />Stop Tap
            </Button>
          )}
        </div>
      </div>

      {liveTap.isActive && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live tap active — streaming events
          {liveTap.events.length > 0 && <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">{liveTap.events.length}</Badge>}
        </div>
      )}

      {liveTap.error && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          Tap error: {liveTap.error}
        </div>
      )}

      {resultQuery.data?.status === "ERROR" && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          Sampling failed. The component may not be producing events.
        </div>
      )}

      {hasExpired && sampleEvents.length === 0 && !isPending && (
        <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          Sampling timed out — no events were captured. Try again or check that the component is receiving data.
        </div>
      )}

      {completedEmpty && sampleEvents.length === 0 && !isPending && !hasExpired && (
        <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          No matching events found for this component. It may not have received data during the sampling window.
        </div>
      )}

      {hasNoEvents && !isPending && !hasExpired && !completedEmpty && !liveTap.isActive && (
        <div className="text-center text-sm text-muted-foreground py-6">
          Use &quot;Live Tap&quot; for real-time streaming or &quot;Sample 10&quot; for a snapshot.
        </div>
      )}

      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {mergedEvents.map((event) => {
          const isExpanded = expandedIds.has(event.id);
          const jsonStr = JSON.stringify(event.data);
          return (
            <div key={`${event.source}-${event.id}`} className="rounded border bg-muted/50">
              <button
                onClick={() => toggleExpand(event.id)}
                className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1.5 text-left text-xs font-mono transition-colors hover:bg-muted"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                {event.source === "tap" && (
                  <span className="shrink-0 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">TAP</span>
                )}
                <span className="truncate text-muted-foreground">
                  {jsonStr.slice(0, 100)}
                  {jsonStr.length > 100 && "..."}
                </span>
              </button>
              {isExpanded && (
                <pre className="border-t px-2 py-1.5 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(event.data, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      {mergedEvents.length > 0 && (
        <div className="text-xs text-muted-foreground text-center">
          Showing {mergedEvents.length} event{mergedEvents.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
