"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Loader2, Play, ChevronDown, ChevronRight } from "lucide-react";

interface LiveTailPanelProps {
  pipelineId: string;
  componentKey: string;
  isDeployed: boolean;
}

export function LiveTailPanel({ pipelineId, componentKey, isDeployed }: LiveTailPanelProps) {
  const trpc = useTRPC();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ data: unknown; expanded: boolean }>>([]);

  // Track which requestId we've already processed to avoid double-processing
  const processedRequestRef = useRef<string | null>(null);

  const processResults = useCallback((data: { status: string; samples?: Array<{ componentKey: string; events: unknown }> }) => {
    if (!requestId || processedRequestRef.current === requestId) return;
    if (data.status !== "COMPLETED" || !data.samples) return;

    const newEvents = data.samples
      .filter((s) => s.componentKey === componentKey)
      .flatMap((s) => {
        const evts = (s.events as unknown[]) ?? [];
        return evts.map((e) => ({ data: e, expanded: false }));
      });

    if (newEvents.length > 0) {
      setEvents((prev) => [...newEvents, ...prev].slice(0, 50));
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
    requestMutation.mutate({
      pipelineId,
      componentKeys: [componentKey],
      limit: 10,
    });
  }, [pipelineId, componentKey, requestMutation]);

  const toggleExpand = useCallback((index: number) => {
    setEvents((prev) =>
      prev.map((e, i) => (i === index ? { ...e, expanded: !e.expanded } : e))
    );
  }, []);

  if (!isDeployed) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Pipeline must be deployed to sample live events.
      </div>
    );
  }

  const isPending = requestMutation.isPending || (!!requestId && resultQuery.data?.status === "PENDING");

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Live Events</span>
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
            <><Play className="h-3 w-3" />Sample 10 Events</>
          )}
        </Button>
      </div>

      {resultQuery.data?.status === "ERROR" && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          Sampling failed. The component may not be producing events.
        </div>
      )}

      {events.length === 0 && !isPending && (
        <div className="text-center text-sm text-muted-foreground py-6">
          Click &quot;Sample 10 Events&quot; to see data flowing through this component.
        </div>
      )}

      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {events.map((event, i) => (
          <div key={i} className="rounded border bg-muted/50">
            <button
              onClick={() => toggleExpand(i)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-mono hover:bg-muted"
            >
              {event.expanded ? (
                <ChevronDown className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate text-muted-foreground">
                {JSON.stringify(event.data).slice(0, 100)}
                {JSON.stringify(event.data).length > 100 && "..."}
              </span>
            </button>
            {event.expanded && (
              <pre className="border-t px-2 py-1.5 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(event.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>

      {events.length > 0 && (
        <div className="text-xs text-muted-foreground text-center">
          Showing {events.length} event{events.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
