"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clipboard, Database, Pause, Play, Radio, Save, Square, Trash2, WrapText } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLiveTap } from "@/hooks/use-live-tap";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { useTeamStore } from "@/stores/team-store";

interface LiveTailPanelProps {
  pipelineId: string;
  componentKey: string | null;
  isDeployed: boolean;
}

export function LiveTailPanel({ pipelineId, componentKey, isDeployed }: LiveTailPanelProps) {
  const liveTap = useLiveTap({ pipelineId, componentId: componentKey ?? "" });
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [buffer, setBuffer] = useState<Array<{ id: string; data: unknown }>>([]);
  const [wrapLines, setWrapLines] = useState(true);

  const trpc = useTRPC();
  const [showSave, setShowSave] = useState(false);
  const [captureName, setCaptureName] = useState("");

  // Lake glue: a "search history in Lake" link when this pipeline has a lake
  // dataset, stitching Live-Tap (live) → Lake (durable history).
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const lakeStatusQuery = useQuery(trpc.lake.status.queryOptions());
  const lakeDatasetsQuery = useQuery({
    ...trpc.lake.listDatasets.queryOptions({ teamId: selectedTeamId ?? "" }),
    enabled: !!selectedTeamId && (lakeStatusQuery.data?.enabled ?? false),
  });
  const hasLakeDataset = (lakeDatasetsQuery.data ?? []).some((d) => d.pipelineId === pipelineId);

  const saveCapture = useMutation(
    trpc.tapCapture.create.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Saved capture "${data.name}" (${data.eventCount} events)`);
        setShowSave(false);
        setCaptureName("");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to save capture");
      },
    }),
  );

  const handleSaveCapture = () => {
    const name = captureName.trim();
    if (!componentKey || name.length === 0 || buffer.length === 0) return;
    saveCapture.mutate({
      pipelineId,
      name,
      componentKey,
      events: buffer.map((e) => e.data),
    });
  };

  useEffect(() => {
    setBuffer([]);
    setPaused(false);
    setShowSave(false);
    setCaptureName("");
    if (liveTap.isActive) liveTap.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentKey]);

  useEffect(() => {
    if (paused) return;
    setBuffer(liveTap.events.slice(0, 200));
  }, [liveTap.events, paused]);

  const lines = useMemo(
    () => buffer.map((e) => JSON.stringify(e.data)).filter(Boolean),
    [buffer],
  );

  const canCopy = typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";

  return (
    <div
      className={`absolute bottom-3 left-3 right-3 z-20 max-w-[720px] overflow-hidden rounded-[3px] border border-line bg-bg-2/95 backdrop-blur-sm resize-y ${expanded ? "h-[320px]" : "h-[180px]"}`}
      style={{ minHeight: 180, maxHeight: "55vh" }}
    >
      <div className="flex h-full flex-col">
        <div className="flex h-7 items-center gap-1 border-b border-line px-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">Live tail</span>
          <span className="ml-1 text-[10px] text-fg-2">{lines.length}/200</span>
          <div className="ml-auto flex items-center gap-1">
            {hasLakeDataset && (
              <Button
                asChild
                size="icon-xs"
                variant="ghost"
                aria-label="Search history in Lake"
                title="Search this pipeline's history in Lake"
              >
                <Link href={`/lake?pipelineId=${pipelineId}`}>
                  <Database className="h-3 w-3" />
                </Link>
              </Button>
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setExpanded((value) => !value)}
              aria-label={expanded ? "Collapse live tail" : "Expand live tail"}
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={!componentKey || !isDeployed || liveTap.isStarting}
              onClick={liveTap.isActive ? liveTap.stop : liveTap.start}
              aria-label={liveTap.isActive ? "Stop live tail" : "Start live tail"}
            >
              {liveTap.isActive ? <Square className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={lines.length === 0 || !canCopy}
              onClick={() => {
                void navigator.clipboard.writeText(lines.join("\n"));
              }}
              aria-label="Copy live tail"
            >
              <Clipboard className="h-3 w-3" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={lines.length === 0 || saveCapture.isPending}
              onClick={() => setShowSave((value) => !value)}
              aria-label="Save capture"
            >
              <Save className="h-3 w-3" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={lines.length === 0}
              onClick={() => {
                setBuffer([]);
              }}
              aria-label="Clear live tail"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={lines.length === 0}
              onClick={() => setWrapLines((value) => !value)}
              aria-label={wrapLines ? "Switch to scroll mode" : "Switch to wrap mode"}
            >
              <WrapText className="h-3 w-3" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={lines.length === 0}
              onClick={() => setPaused((value) => !value)}
              aria-label={paused ? "Resume live tail" : "Pause live tail"}
            >
              {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </Button>
          </div>
        </div>

        {showSave && (
          <div className="flex items-center gap-1 border-b border-line px-2 py-1">
            <Input
              value={captureName}
              onChange={(e) => setCaptureName(e.target.value)}
              placeholder="Capture name"
              maxLength={100}
              aria-label="Capture name"
              className="h-6 flex-1 text-[11px]"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveCapture();
              }}
            />
            <Button
              size="xs"
              variant="primary"
              disabled={captureName.trim().length === 0 || buffer.length === 0 || saveCapture.isPending}
              onClick={handleSaveCapture}
            >
              {saveCapture.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}

        <div
          className={`flex-1 overflow-y-auto p-2 font-mono text-[10px] leading-4 text-fg-1 ${wrapLines ? "" : "overflow-x-auto whitespace-pre"}`}
        >
          {!componentKey && <div className="text-fg-2">Select a component to tail.</div>}
          {componentKey && !isDeployed && <div className="text-fg-2">Deploy pipeline to stream logs.</div>}
          {componentKey && isDeployed && lines.length === 0 && <div className="text-fg-2">No events yet.</div>}
          {lines.map((line, i) => (
            <div
              key={`${i}-${line.slice(0, 16)}`}
              className={wrapLines ? "whitespace-pre-wrap break-all" : "whitespace-nowrap"}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
