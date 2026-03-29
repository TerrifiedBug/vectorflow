"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void): () => void {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

function getSnapshot(): boolean {
  return !document.hidden;
}

function getServerSnapshot(): boolean {
  return true; // SSR always assumes visible
}

/**
 * Returns `true` when the browser tab is visible, `false` when hidden.
 * Uses `useSyncExternalStore` for tear-safe integration with React 19.
 */
export function useDocumentVisibility(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
