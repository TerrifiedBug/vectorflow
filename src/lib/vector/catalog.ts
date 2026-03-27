import type { VectorComponentDef } from "./types";
import { ALL_SOURCES } from "./schemas/sources";
import { ALL_TRANSFORMS } from "./schemas/transforms";
import { ALL_SINKS } from "./schemas/sinks";

let _catalog: VectorComponentDef[] | null = null;

/** PERF-04: Lazy singleton — catalog is built on first access, not at module load. */
export function getVectorCatalog(): VectorComponentDef[] {
  if (!_catalog) {
    _catalog = [...ALL_SOURCES, ...ALL_TRANSFORMS, ...ALL_SINKS];
  }
  return _catalog;
}

/**
 * Find a component definition by type and optionally kind.
 * Kind is required for components that exist as both source and sink
 * (e.g., kafka, socket, vector, file).
 */
export function findComponentDef(
  type: string,
  kind?: VectorComponentDef["kind"],
): VectorComponentDef | undefined {
  const catalog = getVectorCatalog();
  if (kind) {
    return catalog.find((c) => c.type === type && c.kind === kind);
  }
  return catalog.find((c) => c.type === type);
}
