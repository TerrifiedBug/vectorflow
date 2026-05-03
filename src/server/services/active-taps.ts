interface ActiveTap {
  nodeId: string;
  pipelineId: string;
  componentId: string;
  startedAt: number;
}

export const activeTaps = new Map<string, ActiveTap>();
