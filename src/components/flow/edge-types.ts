import type { EdgeTypes } from "@xyflow/react";
import { MetricEdge } from "./metric-edge";

export const edgeTypes = {
  metric: MetricEdge,
} satisfies EdgeTypes;
