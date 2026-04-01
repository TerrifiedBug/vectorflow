// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let instance: MockEventSource;

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  url: string;
  constructor(url: string) {
    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    instance = this;
  }
}

vi.stubGlobal("EventSource", MockEventSource);

import { useFleetEvents } from "@/hooks/use-fleet-events";

describe("useFleetEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects to /api/fleet/events", () => {
    renderHook(() => useFleetEvents());
    expect(instance.url).toBe("/api/fleet/events");
  });

  it("sets connected=true after onopen fires", () => {
    const { result } = renderHook(() => useFleetEvents());
    expect(result.current.connected).toBe(false);

    act(() => {
      instance.onopen?.();
    });

    expect(result.current.connected).toBe(true);
  });

  it("updates nodes on node:status event", () => {
    const { result } = renderHook(() => useFleetEvents());

    const testNodes = [
      { id: "n1", status: "healthy", lastSeen: null, name: "agent-1" },
      { id: "n2", status: "unhealthy", lastSeen: "2024-01-01", name: "agent-2" },
    ];

    act(() => {
      instance.onmessage?.({
        data: JSON.stringify({ type: "node:status", nodes: testNodes }),
      });
    });

    expect(result.current.nodes).toEqual(testNodes);
  });

  it("sets connected=false on error", () => {
    const { result } = renderHook(() => useFleetEvents());

    act(() => {
      instance.onopen?.();
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      instance.onerror?.();
    });
    expect(result.current.connected).toBe(false);
  });

  it("calls close() on unmount", () => {
    const { unmount } = renderHook(() => useFleetEvents());

    expect(instance.close).not.toHaveBeenCalled();
    unmount();
    expect(instance.close).toHaveBeenCalledTimes(1);
  });
});
