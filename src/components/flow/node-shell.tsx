"use client";

import type { ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import { cn } from "@/lib/utils";

export type NodeKind = "source" | "transform" | "sink";

interface NodeShellProps {
  kind: NodeKind;
  /** Mono uppercase type label, e.g. "SOURCE" / "remap" */
  typeLabel: string;
  /** Display name (e.g. "Docker Logs") */
  name: string;
  /** Mono component key / kind name (e.g. "docker_logs") */
  monoName?: string;
  /** Bottom-right throughput, already formatted (e.g. "12.4k ev/s") */
  throughput?: string;
  /** True when the node is selected — adds glow + 1.5px colored border */
  selected?: boolean;
  /** Greyed-out when disabled */
  disabled?: boolean;
  /** Faded when canvas search is filtering and this node doesn't match */
  fadedForSearch?: boolean;
  /** Yellow ring when this node is the highlighted search match */
  searchMatch?: boolean;
  /** Top-right corner badge (validation error, lock, etc.) */
  badge?: ReactNode;
  /** Click + double-click handlers preserved by React Flow's wrapper */
  onClick?: () => void;
}

const NODE_W = 156;
const NODE_H = 60;

const COLOR_VAR: Record<NodeKind, string> = {
  source: "var(--node-source)",
  transform: "var(--node-transform)",
  sink: "var(--node-sink)",
};

const GLOW_VAR: Record<NodeKind, string> = {
  source: "var(--node-source-glow)",
  transform: "var(--node-transform-glow)",
  sink: "var(--node-sink-glow)",
};

/**
 * NodeShell — shared visual chrome for the v2 source/transform/sink node cards.
 *
 * 156×60 rounded card, 1px line-2 border, bg-bg-2 fill, 3px coloured accent
 * stripe on the left, and an absolute-positioned 3.5px React Flow handle on
 * each port that the node kind supports.
 */
export function NodeShell({
  kind,
  typeLabel,
  name,
  monoName,
  throughput,
  selected,
  disabled,
  fadedForSearch,
  searchMatch,
  badge,
}: NodeShellProps) {
  const color = COLOR_VAR[kind];
  const glow = GLOW_VAR[kind];

  return (
    <div
      className={cn(
        "relative",
        fadedForSearch && "opacity-40",
        disabled && "opacity-40",
      )}
    >
      {badge && (
        <div className="absolute -top-2 -right-2 z-10">{badge}</div>
      )}
      <div
        className={cn(
          "relative overflow-hidden rounded-md transition-shadow duration-150",
          searchMatch && "ring-2 ring-yellow-400",
        )}
        style={{
          width: NODE_W,
          height: NODE_H,
          background: "var(--bg-2)",
          border: selected ? `1.5px solid ${color}` : "1px solid var(--line-2)",
          boxShadow: selected
            ? `0 0 0 3px color-mix(in srgb, ${color} 25%, transparent), 0 0 12px ${glow}`
            : undefined,
        }}
      >
        {/* Left accent stripe */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{ width: 3, background: color }}
        />

        {/* Content */}
        <div className="relative h-full pl-[14px] pr-2 py-2 flex flex-col justify-between">
          <div className="min-w-0">
            <div
              className="font-mono uppercase truncate"
              style={{
                color,
                fontSize: 9,
                letterSpacing: "0.04em",
                lineHeight: 1.1,
              }}
            >
              {typeLabel}
            </div>
            <div
              className="text-fg font-medium truncate"
              style={{ fontSize: 12, lineHeight: 1.25, marginTop: 2 }}
            >
              {name}
            </div>
            {monoName && (
              <div
                className="font-mono truncate"
                style={{
                  color: "var(--fg-2)",
                  fontSize: 10,
                  lineHeight: 1.2,
                  marginTop: 1,
                }}
              >
                {monoName}
              </div>
            )}
          </div>
          {throughput && (
            <div
              className="font-mono text-right"
              style={{
                color: "var(--fg-1)",
                fontSize: 9.5,
                lineHeight: 1,
              }}
            >
              {throughput}
            </div>
          )}
        </div>

        {/* Connectors */}
        {kind !== "source" && (
          <Handle
            type="target"
            position={Position.Left}
            style={{
              width: 7,
              height: 7,
              background: "var(--bg)",
              border: `1.5px solid ${color}`,
            }}
          />
        )}
        {kind !== "sink" && (
          <Handle
            type="source"
            position={Position.Right}
            style={{
              width: 7,
              height: 7,
              background: "var(--bg)",
              border: `1.5px solid ${color}`,
            }}
          />
        )}
      </div>
    </div>
  );
}

export const NODE_DIMENSIONS = { width: NODE_W, height: NODE_H } as const;
