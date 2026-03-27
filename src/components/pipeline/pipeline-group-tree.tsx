"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { ChevronRight, ChevronDown, FolderOpen, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

// --- Types ---

export interface GroupNode {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  children: GroupNode[];
}

// --- Tree builder ---

export function buildGroupTree(
  groups: Array<{ id: string; name: string; color: string | null; parentId: string | null }>,
): GroupNode[] {
  const map = new Map<string, GroupNode>();
  for (const g of groups) map.set(g.id, { ...g, children: [] });
  const roots: GroupNode[] = [];
  for (const g of groups) {
    const node = map.get(g.id)!;
    if (!g.parentId) {
      roots.push(node);
    } else {
      map.get(g.parentId)?.children.push(node);
    }
  }
  return roots;
}

// --- Breadcrumb builder ---

export function buildBreadcrumbs(
  groups: Array<{ id: string; name: string; parentId: string | null }>,
  selectedId: string | null,
): Array<{ id: string | null; name: string }> {
  if (!selectedId) return [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const path: Array<{ id: string | null; name: string }> = [];
  let current = byId.get(selectedId);
  while (current) {
    path.unshift({ id: current.id, name: current.name });
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

// --- Tree node component ---

function TreeNode({
  node,
  depth,
  selectedGroupId,
  onSelectGroup,
  pipelineCounts,
}: {
  node: GroupNode;
  depth: number;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  pipelineCounts: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedGroupId === node.id;
  const count = pipelineCounts[node.id] ?? 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none hover:bg-accent/50 transition-colors",
          isSelected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelectGroup(node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="flex items-center shrink-0 text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {isSelected ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: node.color ?? "#64748b" }}
        />

        <span className="flex-1 truncate">{node.name}</span>

        {count > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {count}
          </span>
        )}
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedGroupId={selectedGroupId}
              onSelectGroup={onSelectGroup}
              pipelineCounts={pipelineCounts}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main component ---

interface PipelineGroupTreeProps {
  environmentId: string;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
}

export function PipelineGroupTree({
  environmentId,
  selectedGroupId,
  onSelectGroup,
}: PipelineGroupTreeProps) {
  const trpc = useTRPC();

  const groupsQuery = useQuery(
    trpc.pipelineGroup.list.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );

  const rawGroups = groupsQuery.data ?? [];

  const groups = rawGroups.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    parentId: g.parentId ?? null,
  }));

  const tree = buildGroupTree(groups);

  const pipelineCounts: Record<string, number> = {};
  for (const g of rawGroups) {
    pipelineCounts[g.id] = g._count.pipelines;
  }

  const isAllSelected = selectedGroupId === null;

  return (
    <div className="space-y-0.5">
      {/* All Pipelines root item */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none hover:bg-accent/50 transition-colors",
          isAllSelected && "bg-accent text-accent-foreground",
        )}
        onClick={() => onSelectGroup(null)}
      >
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 font-medium">All Pipelines</span>
      </div>

      {/* Group tree */}
      {tree.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
          pipelineCounts={pipelineCounts}
        />
      ))}
    </div>
  );
}
