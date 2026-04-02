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
import type { ParsedConfig, TranslationResult } from "@/server/services/migration/types";
import { Button } from "@/components/ui/button";

interface MigrationTopologyProps {
  parsedConfig: ParsedConfig;
  translationResult: TranslationResult | null;
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string | null) => void;
  isTranslating?: boolean;
  onRetryAllFailed?: () => void;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;
const COLUMN_SPACING = 300;
const ROW_SPACING = 100;
const START_X = 50;
const START_Y = 50;

function getStatusColor(
  blockId: string,
  translationResult: TranslationResult | null,
): string {
  if (!translationResult) return "#94a3b8"; // slate-400, not yet translated

  const block = translationResult.blocks.find((b) => b.blockId === blockId);
  if (!block) return "#94a3b8";

  if (block.status === "failed") return "#ef4444"; // red-500
  if (block.confidence >= 70) return "#22c55e"; // green-500
  if (block.confidence >= 40) return "#eab308"; // yellow-500
  return "#f97316"; // orange-500
}

const TRANSLATABLE_TYPES = new Set(["source", "match", "filter"]);

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

      if (result.status === "failed") {
        failed++;
      } else if (result.status === "translated" && result.confidence >= 40) {
        translated++;
      } else if (result.status === "translated" && result.confidence < 40) {
        lowConfidence++;
      }
    }

    const pending = total - translated - lowConfidence - failed;
    return { translated, lowConfidence, failed, pending, total };
  }, [parsedConfig, translationResult]);
  const { nodes, edges } = useMemo(() => {
    const sources = parsedConfig.blocks.filter((b) => b.blockType === "source");
    const filters = parsedConfig.blocks.filter((b) => b.blockType === "filter");
    const matches = parsedConfig.blocks.filter((b) => b.blockType === "match");

    const rfNodes: Node[] = [];

    const layoutColumn = (
      blocks: typeof sources,
      columnIndex: number,
    ) => {
      blocks.forEach((block, rowIndex) => {
        const isSelected = block.id === selectedBlockId;
        const color = getStatusColor(block.id, translationResult);

        const hasValidationErrors =
          translationResult?.blocks.some(
            (b) =>
              b.blockId === block.id &&
              b.validationErrors.length > 0,
          ) ?? false;

        const borderColor = hasValidationErrors ? "#ef4444" : color;

        rfNodes.push({
          id: block.id,
          position: {
            x: START_X + columnIndex * COLUMN_SPACING,
            y: START_Y + rowIndex * ROW_SPACING,
          },
          data: {
            label: `${block.pluginType}\n${block.blockType}${block.tagPattern ? `\n${block.tagPattern}` : ""}`,
          },
          style: {
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            backgroundColor: isSelected ? `${color}20` : "#ffffff",
            border: `2px solid ${borderColor}`,
            borderRadius: "8px",
            fontSize: "11px",
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
        });
      });
    };

    layoutColumn(sources, 0);
    layoutColumn(filters, 1);
    layoutColumn(matches, 2);

    // Build edges based on tag pattern matching
    const rfEdges: Edge[] = [];
    let edgeId = 0;

    // Sources -> Filters/Matches (by tag)
    for (const source of sources) {
      const sourceTag = source.params.tag;
      if (!sourceTag) continue;

      for (const target of [...filters, ...matches]) {
        if (!target.tagPattern) continue;
        if (tagMatches(sourceTag, target.tagPattern)) {
          rfEdges.push({
            id: `e${edgeId++}`,
            source: source.id,
            target: target.id,
            animated: true,
            style: { stroke: "#94a3b8" },
          });
        }
      }
    }

    // Filters -> Matches (filters pass through to matches with same tag patterns)
    for (const filter of filters) {
      if (!filter.tagPattern) continue;
      for (const match of matches) {
        if (!match.tagPattern) continue;
        if (
          tagMatches(filter.tagPattern, match.tagPattern) ||
          filter.tagPattern === match.tagPattern
        ) {
          rfEdges.push({
            id: `e${edgeId++}`,
            source: filter.id,
            target: match.id,
            animated: true,
            style: { stroke: "#94a3b8" },
          });
        }
      }
    }

    return { nodes: rfNodes, edges: rfEdges };
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
          fitViewOptions={{ padding: 0.2 }}
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

/** Simple glob-style tag matching for FluentD patterns */
function tagMatches(tag: string, pattern: string): boolean {
  if (pattern === "**") return true;
  // Escape all regex-special characters FIRST, then convert globs
  const regexStr = pattern
    .replace(/[\\^$+?{}()|[\]]/g, "\\$&")  // escape regex specials (incl. backslash)
    .replace(/\./g, "\\.")                   // dots are literal separators
    .replace(/\*\*/g, ".*")                  // ** matches everything
    .replace(/(?<!\.)(\*)(?!\.)/g, "[^.]*"); // * matches within one segment
  try {
    return new RegExp(`^${regexStr}$`).test(tag);
  } catch {
    return false;
  }
}
