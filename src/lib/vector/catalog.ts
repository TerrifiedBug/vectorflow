import type { VectorComponentDef } from "./types";
import { ALL_SOURCES } from "./schemas/sources";
import { ALL_TRANSFORMS } from "./schemas/transforms";
import { ALL_SINKS } from "./schemas/sinks";

export const VECTOR_CATALOG: VectorComponentDef[] = [
  ...ALL_SOURCES,
  ...ALL_TRANSFORMS,
  ...ALL_SINKS,
];

/**
 * Find a component definition by type and optionally kind.
 * Kind is required for components that exist as both source and sink
 * (e.g., kafka, socket, vector, file).
 */
export function findComponentDef(
  type: string,
  kind?: VectorComponentDef["kind"],
): VectorComponentDef | undefined {
  if (kind) {
    return VECTOR_CATALOG.find((c) => c.type === type && c.kind === kind);
  }
  return VECTOR_CATALOG.find((c) => c.type === type);
}
