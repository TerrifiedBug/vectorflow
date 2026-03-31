"use client";

import { type Change } from "diff";
import { ChevronRight, Minus, Plus, RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ConfigDiff } from "@/components/ui/config-diff";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  computeComponentDiff,
  type ComponentDiffResult,
  type EdgeSnapshot,
  type ModifiedNode,
  type NodeSnapshot,
} from "@/lib/version-diff";

// ── Props ────────────────────────────────────────────────────────────

export interface VersionDiffViewerProps {
  oldYaml: string;
  newYaml: string;
  oldLabel: string;
  newLabel: string;
  oldNodes: NodeSnapshot[] | null;
  newNodes: NodeSnapshot[] | null;
  oldEdges: EdgeSnapshot[] | null;
  newEdges: EdgeSnapshot[] | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

const KIND_COLORS: Record<string, { bg: string; fg: string }> = {
  SOURCE: { bg: "bg-node-source", fg: "text-node-source-foreground" },
  TRANSFORM: { bg: "bg-node-transform", fg: "text-node-transform-foreground" },
  SINK: { bg: "bg-node-sink", fg: "text-node-sink-foreground" },
};

function KindBadge({ kind }: { kind: string }) {
  const colors = KIND_COLORS[kind] ?? {
    bg: "bg-muted",
    fg: "text-muted-foreground",
  };
  return (
    <Badge
      size="sm"
      className={`${colors.bg} ${colors.fg} border-0 uppercase`}
    >
      {kind}
    </Badge>
  );
}

/** Render a diffJson Change[] array as colored JSON lines. */
function ConfigChanges({ changes }: { changes: Change[] }) {
  return (
    <pre className="mt-2 rounded-md bg-muted p-3 text-xs font-mono leading-5 max-h-48 overflow-auto">
      {changes.map((change, i) => {
        const lines = change.value.split("\n");
        return lines.map((line, j) => {
          // Skip empty trailing lines from split
          if (j === lines.length - 1 && line === "") return null;
          let cn = "text-muted-foreground";
          let prefix = " ";
          if (change.added) {
            cn = "bg-green-500/15 text-green-700 dark:text-green-400";
            prefix = "+";
          } else if (change.removed) {
            cn = "bg-red-500/15 text-red-700 dark:text-red-400";
            prefix = "-";
          }
          return (
            <div key={`${i}-${j}`} className={cn}>
              {prefix} {line}
            </div>
          );
        });
      })}
    </pre>
  );
}

function buildSummaryParts(diff: ComponentDiffResult): string[] {
  const parts: string[] = [];
  if (diff.added.length > 0)
    parts.push(`${diff.added.length} added`);
  if (diff.modified.length > 0)
    parts.push(`${diff.modified.length} modified`);
  if (diff.removed.length > 0)
    parts.push(`${diff.removed.length} removed`);
  if (diff.edgesAdded.length > 0)
    parts.push(
      `${diff.edgesAdded.length} connection${diff.edgesAdded.length > 1 ? "s" : ""} added`,
    );
  if (diff.edgesRemoved.length > 0)
    parts.push(
      `${diff.edgesRemoved.length} connection${diff.edgesRemoved.length > 1 ? "s" : ""} removed`,
    );
  return parts;
}

// ── Node item ────────────────────────────────────────────────────────

function NodeItem({ node }: { node: NodeSnapshot }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <KindBadge kind={node.kind} />
      <code className="text-xs font-mono">{node.componentKey}</code>
      <span className="text-xs text-muted-foreground">
        {node.componentType}
        {node.displayName ? ` — ${node.displayName}` : ""}
      </span>
    </div>
  );
}

function ModifiedNodeItem({ item }: { item: ModifiedNode }) {
  const [open, setOpen] = useState(false);
  const { node, oldNode, configChanges } = item;

  // Summarise what changed
  const changeDescriptions: string[] = [];
  if (oldNode.componentType !== node.componentType)
    changeDescriptions.push("type");
  if (oldNode.kind !== node.kind) changeDescriptions.push("kind");
  if (oldNode.disabled !== node.disabled)
    changeDescriptions.push("disabled");
  const hasConfigChange = configChanges.some((c) => c.added || c.removed);
  if (hasConfigChange) changeDescriptions.push("config");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 transition-colors">
        <ChevronRight
          className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <KindBadge kind={node.kind} />
        <code className="text-xs font-mono">{node.componentKey}</code>
        <span className="text-xs text-muted-foreground">
          {node.componentType}
          {node.displayName ? ` — ${node.displayName}` : ""}
        </span>
        {changeDescriptions.length > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {changeDescriptions.join(", ")} changed
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-6">
        {oldNode.componentType !== node.componentType && (
          <p className="text-xs py-0.5">
            <span className="text-muted-foreground">Type:</span>{" "}
            <span className="line-through text-red-600 dark:text-red-400">
              {oldNode.componentType}
            </span>{" "}
            →{" "}
            <span className="text-green-600 dark:text-green-400">
              {node.componentType}
            </span>
          </p>
        )}
        {oldNode.kind !== node.kind && (
          <p className="text-xs py-0.5">
            <span className="text-muted-foreground">Kind:</span>{" "}
            <span className="line-through text-red-600 dark:text-red-400">
              {oldNode.kind}
            </span>{" "}
            →{" "}
            <span className="text-green-600 dark:text-green-400">
              {node.kind}
            </span>
          </p>
        )}
        {oldNode.disabled !== node.disabled && (
          <p className="text-xs py-0.5">
            <span className="text-muted-foreground">Disabled:</span>{" "}
            <span className="line-through text-red-600 dark:text-red-400">
              {String(oldNode.disabled)}
            </span>{" "}
            →{" "}
            <span className="text-green-600 dark:text-green-400">
              {String(node.disabled)}
            </span>
          </p>
        )}
        {hasConfigChange && <ConfigChanges changes={configChanges} />}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Section group ────────────────────────────────────────────────────

function DiffSection({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted/60 transition-colors">
        {icon}
        {title}
        <Badge variant="secondary" size="sm" className="ml-1">
          {count}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-4 space-y-0.5">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Component Diff Tab ───────────────────────────────────────────────

function ComponentDiffContent({
  oldNodes,
  newNodes,
  oldEdges,
  newEdges,
}: {
  oldNodes: NodeSnapshot[] | null;
  newNodes: NodeSnapshot[] | null;
  oldEdges: EdgeSnapshot[] | null;
  newEdges: EdgeSnapshot[] | null;
}) {
  // Null-snapshot guard — display notice
  if (oldNodes === null || newNodes === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground italic">
        <Unplug className="size-4" />
        Component-level diff unavailable — this version was created before
        snapshot support.
      </div>
    );
  }

  const diff = computeComponentDiff(oldNodes, newNodes, oldEdges, newEdges);
  const summaryParts = buildSummaryParts(diff);

  // No changes at all
  if (summaryParts.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground italic">
        No component changes detected.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary line */}
      <p className="text-sm text-muted-foreground px-1">
        {summaryParts.join(", ")}
      </p>

      {/* Added */}
      <DiffSection
        title="Added"
        icon={<Plus className="size-4 text-green-600 dark:text-green-400" />}
        count={diff.added.length}
      >
        {diff.added.map((node) => (
          <NodeItem key={node.componentKey} node={node} />
        ))}
      </DiffSection>

      {/* Modified */}
      <DiffSection
        title="Modified"
        icon={
          <RefreshCw className="size-4 text-amber-600 dark:text-amber-400" />
        }
        count={diff.modified.length}
      >
        {diff.modified.map((item) => (
          <ModifiedNodeItem key={item.node.componentKey} item={item} />
        ))}
      </DiffSection>

      {/* Removed */}
      <DiffSection
        title="Removed"
        icon={<Minus className="size-4 text-red-600 dark:text-red-400" />}
        count={diff.removed.length}
      >
        {diff.removed.map((node) => (
          <NodeItem key={node.componentKey} node={node} />
        ))}
      </DiffSection>

      {/* Edge changes */}
      {(diff.edgesAdded.length > 0 || diff.edgesRemoved.length > 0) && (
        <div className="space-y-1 pt-2 border-t">
          <p className="text-xs font-medium text-muted-foreground px-1">
            Connection changes
          </p>
          {diff.edgesAdded.map((edge) => (
            <p
              key={`add-${edge.sourceNodeId}-${edge.targetNodeId}`}
              className="text-xs text-green-600 dark:text-green-400 px-1"
            >
              <Plus className="inline size-3 mr-1" />
              Connection added: {edge.sourceNodeId} → {edge.targetNodeId}
            </p>
          ))}
          {diff.edgesRemoved.map((edge) => (
            <p
              key={`rm-${edge.sourceNodeId}-${edge.targetNodeId}`}
              className="text-xs text-red-600 dark:text-red-400 px-1"
            >
              <Minus className="inline size-3 mr-1" />
              Connection removed: {edge.sourceNodeId} → {edge.targetNodeId}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function VersionDiffViewer({
  oldYaml,
  newYaml,
  oldLabel,
  newLabel,
  oldNodes,
  newNodes,
  oldEdges,
  newEdges,
}: VersionDiffViewerProps) {
  const snapshotsAvailable = oldNodes !== null && newNodes !== null;

  return (
    <Tabs defaultValue="yaml" className="w-full">
      <TabsList>
        <TabsTrigger value="yaml">YAML Diff</TabsTrigger>
        <TabsTrigger
          value="components"
          disabled={!snapshotsAvailable}
          title={
            snapshotsAvailable
              ? undefined
              : "Component-level diff unavailable — snapshots not present for one or both versions"
          }
          className={!snapshotsAvailable ? "opacity-50" : ""}
        >
          Component Diff
        </TabsTrigger>
      </TabsList>

      <TabsContent value="yaml">
        {oldYaml === newYaml ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            No differences — configs are identical.
          </div>
        ) : (
          <ConfigDiff
            oldConfig={oldYaml}
            newConfig={newYaml}
            oldLabel={oldLabel}
            newLabel={newLabel}
            className="p-4 text-xs font-mono leading-5 max-h-64 overflow-auto rounded-md bg-muted"
          />
        )}
      </TabsContent>

      <TabsContent value="components">
        <ComponentDiffContent
          oldNodes={oldNodes}
          newNodes={newNodes}
          oldEdges={oldEdges}
          newEdges={newEdges}
        />
      </TabsContent>
    </Tabs>
  );
}
