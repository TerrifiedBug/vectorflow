"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface ConfigViewerProps {
  config: string;
  selectedLineRange: [number, number] | null;
}

export function ConfigViewer({ config, selectedLineRange }: ConfigViewerProps) {
  const lines = useMemo(() => config.split("\n"), [config]);

  return (
    <pre className="text-xs font-mono overflow-x-auto">
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const isHighlighted =
          selectedLineRange &&
          lineNumber >= selectedLineRange[0] &&
          lineNumber <= selectedLineRange[1];

        return (
          <div
            key={index}
            className={cn(
              "flex hover:bg-muted/50 transition-colors",
              isHighlighted && "bg-primary/10 border-l-2 border-primary",
            )}
          >
            <span className="inline-block w-8 text-right pr-2 text-muted-foreground select-none shrink-0">
              {lineNumber}
            </span>
            <span className="whitespace-pre">{line}</span>
          </div>
        );
      })}
    </pre>
  );
}
