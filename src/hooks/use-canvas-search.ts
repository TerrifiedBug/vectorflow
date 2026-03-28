"use client";

import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { useFlowStore } from "@/stores/flow-store";

/**
 * Hook that pans the canvas to center on the currently active
 * canvas search match whenever the active index changes.
 */
export function useCanvasSearch(): void {
  const reactFlow = useReactFlow();
  const matchIds = useFlowStore((s) => s.canvasSearchMatchIds);
  const activeIndex = useFlowStore((s) => s.canvasSearchActiveIndex);
  const nodes = useFlowStore((s) => s.nodes);

  useEffect(() => {
    if (activeIndex < 0 || matchIds.length === 0) return;
    const targetId = matchIds[activeIndex];
    const node = nodes.find((n) => n.id === targetId);
    if (!node) return;

    reactFlow.setCenter(
      node.position.x + (node.measured?.width ?? 200) / 2,
      node.position.y + (node.measured?.height ?? 60) / 2,
      { zoom: reactFlow.getZoom(), duration: 300 },
    );
  }, [activeIndex, matchIds, nodes, reactFlow]);
}
