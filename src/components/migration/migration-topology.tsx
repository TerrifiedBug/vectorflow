"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import type { ParsedConfig, ParsedBlock, TranslationResult } from "@/server/services/migration/types";
import { Button } from "@/components/ui/button";

interface MigrationTopologyProps {
  parsedConfig: ParsedConfig;
  translationResult: TranslationResult | null;
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string | null) => void;
  isTranslating?: boolean;
  onRetryAllFailed?: () => void;
}

const NODE_WIDTH = 170;
const NODE_HEIGHT = 50;

const TRANSLATABLE_TYPES = new Set(["source", "match", "filter"]);

function getStatusColor(
  blockId: string,
  translationResult: TranslationResult | null,
): string {
  if (!translationResult) return "#94a3b8";

  const block = translationResult.blocks.find((b) => b.blockId === blockId);
  if (!block) return "#94a3b8";

  if (block.status === "failed") return "#ef4444";
  if (block.confidence >= 70) return "#22c55e";
  if (block.confidence >= 40) return "#eab308";
  return "#f97316";
}

/** Simple glob-style tag matching for FluentD patterns */
function tagMatches(tag: string, pattern: string): boolean {
  if (pattern === "**") return true;
  const regexStr = pattern
    .replace(/[\\^$+?{}()|[\]]/g, "\\$&")
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/(?<!\.)(\*)(?!\.)/g, "[^.]*");
  try {
    return new RegExp(`^${regexStr}$`).test(tag);
  } catch {
    return false;
  }
}

/**
 * Extract output tags from a rewrite_tag_filter's nested <rule> blocks.
 * Each rule has a `tag` param specifying the new tag it emits.
 */
function getRewriteOutputTags(block: ParsedBlock): string[] {
  if (block.pluginType !== "rewrite_tag_filter") return [];
  const tags: string[] = [];
  for (const nested of block.nestedBlocks) {
    if (nested.params.tag) tags.push(nested.params.tag);
  }
  return tags;
}

/**
 * Trace a tag through all filters in config order, returning only
 * those whose tagPattern matches. This models FluentD's actual
 * processing: filters run top-to-bottom, each applies if its pattern
 * matches the event tag (including glob patterns like auth0.**).
 */
function traceFilterChain(tag: string, filters: ParsedBlock[]): ParsedBlock[] {
  return filters.filter((f) => f.tagPattern && tagMatches(tag, f.tagPattern));
}

/**
 * Collect all concrete tags that flow through the pipeline.
 * Sources emit tags directly. rewrite_tag_filter matches emit new tags.
 */
function collectTags(
  sources: ParsedBlock[],
  matches: ParsedBlock[],
): Array<{ tag: string; emitter: ParsedBlock }> {
  const tags: Array<{ tag: string; emitter: ParsedBlock }> = [];

  for (const source of sources) {
    const tag = source.params.tag;
    if (tag) tags.push({ tag, emitter: source });
  }

  for (const match of matches) {
    for (const outputTag of getRewriteOutputTags(match)) {
      tags.push({ tag: outputTag, emitter: match });
    }
  }

  return tags;
}

/**
 * Build edges representing FluentD's routing semantics:
 * - Source/rewrite emits a tag
 * - Filters are processed in CONFIG ORDER — each matching filter applies
 * - After all filters, events hit the first matching <match> block
 */
function buildFluentdEdges(
  sources: ParsedBlock[],
  filters: ParsedBlock[],
  matches: ParsedBlock[],
): Array<{ from: string; to: string }> {
  const seen = new Set<string>();
  const edges: Array<{ from: string; to: string }> = [];

  const addEdge = (from: string, to: string) => {
    if (from === to) return;
    const key = `${from}->${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to });
  };

  // For source tags, connect source → rewrite_tag_filter or first filter
  for (const source of sources) {
    const tag = source.params.tag;
    if (!tag) continue;

    // Does a match block (like rewrite_tag_filter) consume this tag?
    const consumingMatch = matches.find(
      (m) => m.tagPattern && tagMatches(tag, m.tagPattern),
    );

    // Get the filter chain for this tag
    const chain = traceFilterChain(tag, filters);

    if (chain.length > 0) {
      addEdge(source.id, chain[0].id);
    } else if (consumingMatch) {
      addEdge(source.id, consumingMatch.id);
    }

    // Chain filters and connect last to match
    for (let i = 0; i < chain.length - 1; i++) {
      addEdge(chain[i].id, chain[i + 1].id);
    }

    if (chain.length > 0 && consumingMatch) {
      addEdge(chain[chain.length - 1].id, consumingMatch.id);
    }
  }

  // For tags emitted by rewrite_tag_filter, trace through filters to final match
  const allTags = collectTags(sources, matches);
  const rewriteTags = allTags.filter(
    (t) => t.emitter.pluginType === "rewrite_tag_filter",
  );

  for (const { tag, emitter } of rewriteTags) {
    const chain = traceFilterChain(tag, filters);
    const finalMatch = matches.find(
      (m) =>
        m.id !== emitter.id &&
        m.tagPattern &&
        tagMatches(tag, m.tagPattern),
    );

    if (chain.length > 0) {
      addEdge(emitter.id, chain[0].id);
      for (let i = 0; i < chain.length - 1; i++) {
        addEdge(chain[i].id, chain[i + 1].id);
      }
      if (finalMatch) {
        addEdge(chain[chain.length - 1].id, finalMatch.id);
      }
    } else if (finalMatch) {
      addEdge(emitter.id, finalMatch.id);
    }
  }

  return edges;
}

/**
 * Use dagre to compute a left-to-right layout that fits all nodes.
 */
function layoutWithDagre(
  rfNodes: Node[],
  rfEdges: Edge[],
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 40,
    ranksep: 60,
    marginx: 20,
    marginy: 20,
  });

  for (const node of rfNodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of rfEdges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return rfNodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

export function MigrationTopology({
  parsedConfig,
  translationResult,
  selectedBlockId,
  onSelectBlock,
  isTranslating,
  onRetryAllFailed,
}: MigrationTopologyProps) {
  const statusCounts = useMemo(() => {
    const translatableBlocks = parsedConfig.blocks.filter((b) =>
      TRANSLATABLE_TYPES.has(b.blockType),
    );
    const total = translatableBlocks.length;

    if (!translationResult) {
      return { translated: 0, lowConfidence: 0, failed: 0, pending: total, total };
    }

    let translated = 0;
    let lowConfidence = 0;
    let failed = 0;

    for (const block of translatableBlocks) {
      const result = translationResult.blocks.find((b) => b.blockId === block.id);
      if (!result) continue;
      if (result.status === "failed") failed++;
      else if (result.status === "translated" && result.confidence >= 40) translated++;
      else if (result.status === "translated" && result.confidence < 40) lowConfidence++;
    }

    const pending = total - translated - lowConfidence - failed;
    return { translated, lowConfidence, failed, pending, total };
  }, [parsedConfig, translationResult]);

  const { nodes, edges } = useMemo(() => {
    const sources = parsedConfig.blocks.filter((b) => b.blockType === "source");
    const filters = parsedConfig.blocks.filter((b) => b.blockType === "filter");
    const matches = parsedConfig.blocks.filter((b) => b.blockType === "match");

    // Build edges first (dagre needs them for layout)
    const logicalEdges = buildFluentdEdges(sources, filters, matches);
    const rfEdges: Edge[] = logicalEdges.map((e, i) => ({
      id: `e${i}`,
      source: e.from,
      target: e.to,
      animated: true,
      style: { stroke: "#64748b" },
    }));

    // Build nodes (position will be set by dagre)
    const allBlocks = [...sources, ...filters, ...matches];
    const rfNodes: Node[] = allBlocks.map((block) => {
      const isSelected = block.id === selectedBlockId;
      const color = getStatusColor(block.id, translationResult);
      const hasValidationErrors =
        translationResult?.blocks.some(
          (b) => b.blockId === block.id && b.validationErrors.length > 0,
        ) ?? false;
      const borderColor = hasValidationErrors ? "#ef4444" : color;

      return {
        id: block.id,
        position: { x: 0, y: 0 }, // dagre will set this
        data: {
          label: `${block.pluginType}\n${block.blockType}${block.tagPattern ? `\n${block.tagPattern}` : ""}`,
        },
        style: {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          backgroundColor: isSelected ? `${color}20` : `${color}15`,
          border: `2px solid ${borderColor}`,
          borderRadius: "8px",
          fontSize: "11px",
          color: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center" as const,
          cursor: "pointer",
          boxShadow: isSelected ? `0 0 0 2px ${color}` : "none",
          whiteSpace: "pre-line" as const,
          padding: "4px",
        },
        type: "default",
      };
    });

    // Layout with dagre
    const positioned = layoutWithDagre(rfNodes, rfEdges);
    return { nodes: positioned, edges: rfEdges };
  }, [parsedConfig, translationResult, selectedBlockId]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onSelectBlock(node.id === selectedBlockId ? null : node.id);
    },
    [onSelectBlock, selectedBlockId],
  );

  const { translated, lowConfidence, failed, pending, total } = statusCounts;
  const completedCount = translated + lowConfidence + failed;
  const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Status header */}
      <div className="flex items-center gap-4 px-3 py-2 border-b text-sm">
        {translated > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
            {translated} translated
          </span>
        )}
        {lowConfidence > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500" />
            {lowConfidence} low confidence
          </span>
        )}
        {failed > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
            {failed} failed
          </span>
        )}
        {pending > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-400" />
            {pending} pending
          </span>
        )}
        {isTranslating && (
          <span className="text-muted-foreground ml-auto">
            Translating {completedCount} of {total}...
          </span>
        )}
        {!isTranslating && failed > 0 && onRetryAllFailed && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onRetryAllFailed}
          >
            Retry all failed
          </Button>
        )}
      </div>

      {/* Progress bar */}
      {isTranslating && (
        <div className="h-1 bg-muted">
          <div
            className="h-1 bg-primary transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={handleNodeClick}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
