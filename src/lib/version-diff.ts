import { diffJson, type Change } from "diff";

// ── Snapshot interfaces ──────────────────────────────────────────────

export interface NodeSnapshot {
  id: string;
  componentKey: string;
  displayName: string;
  componentType: string;
  kind: string;
  config: unknown;
  positionX: number;
  positionY: number;
  disabled: boolean;
}

export interface EdgeSnapshot {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort: string;
}

// ── Diff result types ────────────────────────────────────────────────

export interface ModifiedNode {
  node: NodeSnapshot;
  oldNode: NodeSnapshot;
  configChanges: Change[];
}

export interface ComponentDiffResult {
  added: NodeSnapshot[];
  removed: NodeSnapshot[];
  modified: ModifiedNode[];
  unchanged: NodeSnapshot[];
  edgesAdded: EdgeSnapshot[];
  edgesRemoved: EdgeSnapshot[];
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Stable JSON.stringify that sorts object keys so that
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce the same string.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}

/**
 * Returns true when the *semantic* fields of two nodes are identical.
 * Position (positionX, positionY), displayName, and id are intentionally
 * excluded from the comparison per design decision D026.
 */
function isSemanticallyEqual(a: NodeSnapshot, b: NodeSnapshot): boolean {
  return (
    a.componentType === b.componentType &&
    a.kind === b.kind &&
    a.disabled === b.disabled &&
    stableStringify(a.config) === stableStringify(b.config)
  );
}

/** Composite key for edge identity. */
function edgeKey(e: EdgeSnapshot): string {
  return `${e.sourceNodeId}→${e.targetNodeId}`;
}

// ── Main diff function ───────────────────────────────────────────────

/**
 * Compute a component-level diff between two pipeline version snapshots.
 *
 * Nodes are keyed by `componentKey` (not `id`).  Position-only and
 * displayName-only changes are treated as "unchanged".  Null inputs are
 * treated as empty arrays so callers never need to guard.
 */
export function computeComponentDiff(
  oldNodes: NodeSnapshot[] | null,
  newNodes: NodeSnapshot[] | null,
  oldEdges: EdgeSnapshot[] | null,
  newEdges: EdgeSnapshot[] | null,
): ComponentDiffResult {
  const oNodes = oldNodes ?? [];
  const nNodes = newNodes ?? [];
  const oEdges = oldEdges ?? [];
  const nEdges = newEdges ?? [];

  // Build lookup maps keyed by componentKey
  const oldMap = new Map<string, NodeSnapshot>();
  for (const n of oNodes) oldMap.set(n.componentKey, n);

  const newMap = new Map<string, NodeSnapshot>();
  for (const n of nNodes) newMap.set(n.componentKey, n);

  const added: NodeSnapshot[] = [];
  const removed: NodeSnapshot[] = [];
  const modified: ModifiedNode[] = [];
  const unchanged: NodeSnapshot[] = [];

  // Classify each node in the new snapshot
  for (const [key, node] of newMap) {
    const oldNode = oldMap.get(key);
    if (!oldNode) {
      added.push(node);
    } else if (isSemanticallyEqual(oldNode, node)) {
      unchanged.push(node);
    } else {
      // Compute granular config changes using diffJson
      const configChanges = diffJson(
        stableStringify(oldNode.config) ?? "null",
        stableStringify(node.config) ?? "null",
      );
      modified.push({ node, oldNode, configChanges });
    }
  }

  // Nodes only in old → removed
  for (const [key, node] of oldMap) {
    if (!newMap.has(key)) {
      removed.push(node);
    }
  }

  // Edge diff – keyed by sourceNodeId→targetNodeId
  const oldEdgeMap = new Map<string, EdgeSnapshot>();
  for (const e of oEdges) oldEdgeMap.set(edgeKey(e), e);

  const newEdgeMap = new Map<string, EdgeSnapshot>();
  for (const e of nEdges) newEdgeMap.set(edgeKey(e), e);

  const edgesAdded: EdgeSnapshot[] = [];
  for (const [key, edge] of newEdgeMap) {
    if (!oldEdgeMap.has(key)) edgesAdded.push(edge);
  }

  const edgesRemoved: EdgeSnapshot[] = [];
  for (const [key, edge] of oldEdgeMap) {
    if (!newEdgeMap.has(key)) edgesRemoved.push(edge);
  }

  return { added, removed, modified, unchanged, edgesAdded, edgesRemoved };
}
