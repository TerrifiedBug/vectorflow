"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, Trash2, Radio, Square } from "lucide-react";
import { useLiveTap } from "@/hooks/use-live-tap";
import { Button } from "@/components/ui/button";

interface LiveTailPanelProps {
  pipelineId: string;
  componentKey: string | null;
  isDeployed: boolean;
}

export function LiveTailPanel({ pipelineId, componentKey, isDeployed }: LiveTailPanelProps) {
  const liveTap = useLiveTap({ pipelineId, componentId: componentKey ?? "" });
  const [paused, setPaused] = useState(false);
  const [buffer, setBuffer] = useState<Array<{ id: string; data: unknown }>>([]);

  useEffect(() => {
    setBuffer([]);
    setPaused(false);
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

  return (
    <div className="absolute bottom-3 left-3 z-20 h-[140px] w-[360px] rounded-[3px] border border-line bg-bg-2/95 backdrop-blur-sm">
      <div className="flex h-7 items-center gap-1 border-b border-line px-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">Live tail</span>
        <span className="ml-1 text-[10px] text-fg-2">{lines.length}/200</span>
        <div className="ml-auto flex items-center gap-1">
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
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? "Resume live tail" : "Pause live tail"}
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      <div className="h-[calc(140px-28px)] overflow-y-auto p-2 font-mono text-[10px] leading-4 text-fg-1">
        {!componentKey && <div className="text-fg-2">Select a component to tail.</div>}
        {componentKey && !isDeployed && <div className="text-fg-2">Deploy pipeline to stream logs.</div>}
        {componentKey && isDeployed && lines.length === 0 && <div className="text-fg-2">No events yet.</div>}
        {lines.map((line, i) => (
          <div key={`${i}-${line.slice(0, 16)}`} className="truncate">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
