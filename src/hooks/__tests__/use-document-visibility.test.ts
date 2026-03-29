// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDocumentVisibility } from "@/hooks/use-document-visibility";

describe("useDocumentVisibility", () => {
  const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");

  afterEach(() => {
    if (originalHidden) {
      Object.defineProperty(document, "hidden", originalHidden);
    }
    vi.restoreAllMocks();
  });

  it("returns true when document is not hidden", () => {
    Object.defineProperty(document, "hidden", {
      value: false,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useDocumentVisibility());
    expect(result.current).toBe(true);
  });

  it("returns false when document is hidden", () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useDocumentVisibility());
    expect(result.current).toBe(false);
  });

  it("updates when visibility changes", () => {
    Object.defineProperty(document, "hidden", {
      value: false,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useDocumentVisibility());
    expect(result.current).toBe(true);

    act(() => {
      Object.defineProperty(document, "hidden", {
        value: true,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe(false);
  });
});
