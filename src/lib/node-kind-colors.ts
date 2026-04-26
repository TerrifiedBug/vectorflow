// Shared color tokens for source/transform/sink nodes. Used by the pipeline
// editor palette and the shared-components library so both surfaces match.

export type NodeKind = "source" | "transform" | "sink";

export interface NodeKindMeta {
  label: string;          // singular ("Source")
  pluralLabel: string;    // plural ("Sources")
  borderClass: string;    // left-border accent for cards
  bgClass: string;        // solid color background (icon tiles, badges)
  bgGlowClass: string;    // soft 30% background (subtle fills)
  fgClass: string;        // foreground text color on solid background
  accentClass: string;    // text accent on neutral background
}

export const NODE_KIND_META: Record<NodeKind, NodeKindMeta> = {
  source: {
    label: "Source",
    pluralLabel: "Sources",
    borderClass: "border-l-node-source",
    bgClass: "bg-node-source",
    bgGlowClass: "bg-node-source-glow",
    fgClass: "text-node-source-foreground",
    accentClass: "text-node-source",
  },
  transform: {
    label: "Transform",
    pluralLabel: "Transforms",
    borderClass: "border-l-node-transform",
    bgClass: "bg-node-transform",
    bgGlowClass: "bg-node-transform-glow",
    fgClass: "text-node-transform-foreground",
    accentClass: "text-node-transform",
  },
  sink: {
    label: "Sink",
    pluralLabel: "Sinks",
    borderClass: "border-l-node-sink",
    bgClass: "bg-node-sink",
    bgGlowClass: "bg-node-sink-glow",
    fgClass: "text-node-sink-foreground",
    accentClass: "text-node-sink",
  },
};

export const NODE_KIND_ORDER: readonly NodeKind[] = ["source", "transform", "sink"] as const;

// Library/Prisma uses upper-case enum (`SOURCE`/`TRANSFORM`/`SINK`); pipeline
// editor uses the lowercase form. This normalises either to the canonical kind.
export function toNodeKind(value: string): NodeKind {
  const lower = value.toLowerCase();
  if (lower === "source" || lower === "transform" || lower === "sink") {
    return lower;
  }
  return "source";
}
