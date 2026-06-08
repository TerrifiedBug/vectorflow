import type { DataType, VectorComponentDef } from "./types";

/**
 * The single source of truth for DataType edge compatibility, shared by the
 * canvas connection gate (flow-canvas `validateConnection`) and the inspector's
 * component-type switcher (detail-panel) so a swap the editor offers is never a
 * connection the canvas would reject.
 */

type TypedComponent = Pick<VectorComponentDef, "inputTypes" | "outputTypes">;

/**
 * Data types a component emits (`output`) or accepts (`input`). Input falls back
 * to output types for type-agnostic transforms that don't declare inputs.
 */
export function componentDataTypes(
  def: TypedComponent | undefined,
  direction: "input" | "output",
): DataType[] {
  if (!def) return [];
  return direction === "output"
    ? (def.outputTypes ?? [])
    : (def.inputTypes ?? def.outputTypes ?? []);
}

/**
 * Whether a producer's output types are compatible with a consumer's input
 * types. An empty list on either side is type-agnostic → permissive (preserves
 * behaviour for components with no declared types).
 */
export function dataTypesCompatible(
  producerOut: DataType[],
  consumerIn: DataType[],
): boolean {
  if (producerOut.length === 0 || consumerIn.length === 0) return true;
  return producerOut.some((t) => consumerIn.includes(t));
}

/** Data-type constraints imposed on a node by its current edges. */
export interface NeighborTypeConstraints {
  /** Output types of each upstream neighbor (incoming-edge source). */
  incomingOutputs: DataType[][];
  /** Input types of each downstream neighbor (outgoing-edge target). */
  outgoingInputs: DataType[][];
}

/**
 * Whether a candidate component could replace a node in place without making any
 * of its current edges type-invalid: it must accept every upstream neighbor's
 * output and produce something every downstream neighbor accepts.
 */
export function isReplacementCompatible(
  candidate: TypedComponent,
  constraints: NeighborTypeConstraints,
): boolean {
  const candidateIn = componentDataTypes(candidate, "input");
  const candidateOut = componentDataTypes(candidate, "output");
  return (
    constraints.incomingOutputs.every((out) =>
      dataTypesCompatible(out, candidateIn),
    ) &&
    constraints.outgoingInputs.every((inp) =>
      dataTypesCompatible(candidateOut, inp),
    )
  );
}
