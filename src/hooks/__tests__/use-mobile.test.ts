// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useIsMobile } from "@/hooks/use-mobile";

describe("useIsMobile", () => {
  let changeHandler: (() => void) | null = null;
  const mockAddEventListener = vi.fn(
    (_event: string, handler: () => void) => {
      changeHandler = handler;
    },
  );
  const mockRemoveEventListener = vi.fn();

  const originalMatchMedia = window.matchMedia;
  const originalInnerWidth = Object.getOwnPropertyDescriptor(
    window,
    "innerWidth",
  );

  function setViewportWidth(width: number) {
    Object.defineProperty(window, "innerWidth", {
      value: width,
      writable: true,
      configurable: true,
    });
  }

  function mockMatchMediaForWidth() {
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener,
      matches: false,
    });
  }

  beforeEach(() => {
    changeHandler = null;
    mockAddEventListener.mockClear();
    mockRemoveEventListener.mockClear();
    mockMatchMediaForWidth();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    if (originalInnerWidth) {
      Object.defineProperty(window, "innerWidth", originalInnerWidth);
    }
  });

  it("returns false for desktop viewport (width=1024)", () => {
    setViewportWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("returns true for mobile viewport (width=500)", () => {
    setViewportWidth(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("updates when media query change event fires", () => {
    setViewportWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setViewportWidth(500);
      changeHandler?.();
    });

    expect(result.current).toBe(true);
  });
});
