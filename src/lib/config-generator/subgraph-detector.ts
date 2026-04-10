import type { ParsedComponent } from "./vector-parser";

export interface Subgraph {
  suggestedName: string;
  components: ParsedComponent[];
}

export interface SubgraphResult {
  subgraphs: Subgraph[];
}

// ---------------------------------------------------------------------------
// Union-Find with path compression and union by rank
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();

  add(id: string): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent === undefined) return id;
    if (parent === id) return id;
    // Path compression
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    const rankA = this.rank.get(rootA) ?? 0;
    const rankB = this.rank.get(rootB) ?? 0;

    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Name generation
// ---------------------------------------------------------------------------

function typeToSlug(type: string): string {
  return type.replace(/_/g, "-");
}

function generateName(components: ParsedComponent[]): string {
  const sources = components.filter((c) => c.kind === "source");
  const sinks = components.filter((c) => c.kind === "sink");

  const sourceType = sources.length > 0 ? typeToSlug(sources[0].componentType) : "unknown";
  const sinkType = sinks.length > 0 ? typeToSlug(sinks[0].componentType) : "unknown";

  return `${sourceType}-to-${sinkType}`;
}

// ---------------------------------------------------------------------------
// Main detector
// ---------------------------------------------------------------------------

export function detectSubgraphs(
  components: ParsedComponent[],
  filename?: string,
): SubgraphResult {
  if (components.length === 0) {
    return { subgraphs: [] };
  }

  const uf = new UnionFind();

  // Register all components
  for (const c of components) {
    uf.add(c.componentKey);
  }

  // Build lookup for quick key existence check
  const keySet = new Set(components.map((c) => c.componentKey));

  // Union each component with its inputs
  for (const c of components) {
    for (const input of c.inputs) {
      if (keySet.has(input)) {
        uf.union(c.componentKey, input);
      }
    }
  }

  // Group components by their root
  const groups = new Map<string, ParsedComponent[]>();
  for (const c of components) {
    const root = uf.find(c.componentKey);
    const group = groups.get(root);
    if (group) {
      group.push(c);
    } else {
      groups.set(root, [c]);
    }
  }

  // Build subgraphs with names
  const subgraphs: Subgraph[] = Array.from(groups.values()).map((groupComponents) => ({
    suggestedName: generateName(groupComponents),
    components: groupComponents,
  }));

  // Sort by component count descending
  subgraphs.sort((a, b) => b.components.length - a.components.length);

  // Apply filename fallback when there is exactly one subgraph and a filename is provided
  if (subgraphs.length === 1 && filename) {
    const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
    subgraphs[0] = { ...subgraphs[0], suggestedName: nameWithoutExt };
  }

  return { subgraphs };
}
