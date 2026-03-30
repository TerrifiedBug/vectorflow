"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FleetStatusEvent } from "@/lib/sse/types";
import { useSSE } from "@/hooks/use-sse";
import { toast } from "sonner";

export type UpdateStage = "updating" | "restarting" | "complete" | "failed" | null;

interface Tracking {
  nodeId: string;
  targetVersion: string;
  startedAt: number;
}

const TIMEOUT_MS = 60_000;
const COMPLETE_CLEAR_MS = 5_000;

export function createUpdateTracker(onStageChange: (stage: UpdateStage) => void) {
  let tracking: Tracking | null = null;
  let stage: UpdateStage = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function setStage(next: UpdateStage) {
    stage = next;
    onStageChange(next);
  }

  function clearTimer() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function startTracking(nodeId: string, targetVersion: string) {
    clearTimer();
    tracking = { nodeId, targetVersion, startedAt: Date.now() };
    setStage("updating");

    timeoutId = setTimeout(() => {
      if (stage === "updating" || stage === "restarting") {
        toast.warning("Update may have failed — check agent logs");
        tracking = null;
        setStage(null);
      }
    }, TIMEOUT_MS);
  }

  function handleFleetStatus(event: FleetStatusEvent) {
    if (!tracking || event.nodeId !== tracking.nodeId) return;

    if (event.status === "UNREACHABLE" && stage === "updating") {
      setStage("restarting");
      return;
    }

    if (event.status === "HEALTHY" && (stage === "updating" || stage === "restarting")) {
      clearTimer();
      setStage("complete");
      toast.success(`Agent updated to ${tracking.targetVersion}`);

      setTimeout(() => {
        if (stage === "complete") {
          tracking = null;
          setStage(null);
        }
      }, COMPLETE_CLEAR_MS);
    }
  }

  function dispose() {
    clearTimer();
    tracking = null;
    stage = null;
  }

  return {
    startTracking,
    handleFleetStatus,
    getStage: () => stage,
    getNodeId: () => tracking?.nodeId ?? null,
    dispose,
  };
}

export function useAgentUpdateTracker() {
  const { subscribe, unsubscribe } = useSSE();
  const [stage, setStage] = useState<UpdateStage>(null);
  const [trackedNodeId, setTrackedNodeId] = useState<string | null>(null);
  const trackerRef = useRef(createUpdateTracker(setStage));

  useEffect(() => {
    const tracker = trackerRef.current;

    const subId = subscribe("fleet_status", (event) => {
      tracker.handleFleetStatus(event as FleetStatusEvent);
    });

    return () => {
      unsubscribe(subId);
      tracker.dispose();
    };
  }, [subscribe, unsubscribe]);

  const startTracking = useCallback(
    (nodeId: string, targetVersion: string) => {
      trackerRef.current.startTracking(nodeId, targetVersion);
      setTrackedNodeId(nodeId);
    },
    [],
  );

  return {
    stage,
    trackedNodeId,
    startTracking,
  };
}
