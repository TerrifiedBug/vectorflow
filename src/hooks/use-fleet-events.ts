"use client";
import { useState, useEffect } from "react";

interface FleetNode {
  id: string;
  status: string;
  lastSeen: string | null;
  name: string;
}

export function useFleetEvents() {
  const [nodes, setNodes] = useState<FleetNode[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource("/api/fleet/events");

    eventSource.onopen = () => setConnected(true);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "node:status") {
        setNodes(data.nodes);
      }
    };
    eventSource.onerror = () => setConnected(false);

    return () => eventSource.close();
  }, []);

  return { nodes, connected };
}
