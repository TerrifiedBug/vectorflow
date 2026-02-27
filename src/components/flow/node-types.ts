import { SourceNode } from "./source-node";
import { TransformNode } from "./transform-node";
import { SinkNode } from "./sink-node";

export const nodeTypes = {
  source: SourceNode,
  transform: TransformNode,
  sink: SinkNode,
};
