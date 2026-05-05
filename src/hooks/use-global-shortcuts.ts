"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { triggerCommandPalette } from "@/components/command-palette";
import { triggerKeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal";

const G_ROUTES: Record<string, string> = {
  d: "/",
  p: "/pipelines",
  f: "/fleet",
  a: "/alerts",
  i: "/incidents",
  s: "/settings",
};

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.isContentEditable ||
    !!element.closest("[contenteditable='true'], .monaco-editor")
  );
}

function hasOpenDialog() {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
}

/** Dashboard-wide v2 shortcuts: g-sequences, ⌘K, ⌘/, ?, / search focus, guarded for forms/dialogs. */
export function useGlobalShortcuts() {
  const router = useRouter();
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingForG = useRef(false);

  useEffect(() => {
    function resetLeader() {
      waitingForG.current = false;
      if (gTimer.current) clearTimeout(gTimer.current);
      gTimer.current = null;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        triggerCommandPalette();
        resetLeader();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        triggerKeyboardShortcutsModal();
        resetLeader();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        resetLeader();
        return;
      }

      if (event.key === "?" && !hasOpenDialog()) {
        event.preventDefault();
        triggerKeyboardShortcutsModal();
        resetLeader();
        return;
      }

      if (event.key === "/" && !hasOpenDialog()) {
        event.preventDefault();
        const search = document.querySelector<HTMLElement>('[role="search"]');
        search?.focus();
        search?.click();
        resetLeader();
        return;
      }

      const key = event.key.toLowerCase();
      if (waitingForG.current) {
        const href = G_ROUTES[key];
        if (href) {
          event.preventDefault();
          router.push(href);
        }
        resetLeader();
        return;
      }

      if (key === "g" && !hasOpenDialog()) {
        waitingForG.current = true;
        if (gTimer.current) clearTimeout(gTimer.current);
        gTimer.current = setTimeout(resetLeader, 1_000);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      resetLeader();
    };
  }, [router]);
}
