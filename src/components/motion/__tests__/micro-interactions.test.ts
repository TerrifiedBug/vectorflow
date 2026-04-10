/**
 * Micro-interactions integration checks.
 *
 * These tests verify that the correct primitives are exported and that
 * animation-related classes exist in the UI components that rely on them.
 * They intentionally use file-import/grep-style checks to stay fast and
 * avoid needing DOM rendering for what is purely a structural audit.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Resolve project root from __dirname
const root = path.resolve(__dirname, "../../../../");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// Barrel exports
// ---------------------------------------------------------------------------

describe("motion barrel exports", () => {
  it("exports PressableScale", async () => {
    const { PressableScale } = await import("@/components/motion");
    expect(PressableScale).toBeDefined();
    expect(typeof PressableScale).toBe("function");
  });

  it("exports springTransition", async () => {
    const { springTransition } = await import("@/components/motion");
    expect(springTransition).toBeDefined();
    expect(springTransition).toMatchObject({ type: "spring" });
  });

  it("exports FadeIn", async () => {
    const { FadeIn } = await import("@/components/motion");
    expect(FadeIn).toBeDefined();
    expect(typeof FadeIn).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// dialog.tsx — verify animate-in / animate-out classes
// ---------------------------------------------------------------------------

describe("dialog.tsx animation classes", () => {
  const dialogSrc = readFile("src/components/ui/dialog.tsx");

  it("contains animate-in class", () => {
    expect(dialogSrc).toContain("animate-in");
  });

  it("contains animate-out class", () => {
    expect(dialogSrc).toContain("animate-out");
  });
});

// ---------------------------------------------------------------------------
// sonner.tsx — verify --normal-bg CSS variable theming
// ---------------------------------------------------------------------------

describe("sonner.tsx theming", () => {
  const sonnerSrc = readFile("src/components/ui/sonner.tsx");

  it("uses --normal-bg CSS variable", () => {
    expect(sonnerSrc).toContain("--normal-bg");
  });

  it("imports Sonner from sonner package", () => {
    expect(sonnerSrc).toContain("sonner");
  });
});

// ---------------------------------------------------------------------------
// flow-toolbar.tsx — Deploy button wrapped with PressableScale
// ---------------------------------------------------------------------------

describe("flow-toolbar.tsx micro-interactions", () => {
  const toolbarSrc = readFile("src/components/flow/flow-toolbar.tsx");

  it("imports PressableScale", () => {
    expect(toolbarSrc).toContain("PressableScale");
  });
});

// ---------------------------------------------------------------------------
// deploy-progress.tsx — FadeIn and AnimatePresence applied
// ---------------------------------------------------------------------------

describe("deploy-progress.tsx micro-interactions", () => {
  const progressSrc = readFile("src/components/deploy-progress.tsx");

  it("imports and uses FadeIn", () => {
    expect(progressSrc).toContain("FadeIn");
  });

  it("imports and uses AnimatePresence", () => {
    expect(progressSrc).toContain("AnimatePresence");
  });

  it("respects reduced motion for expand/collapse", () => {
    expect(progressSrc).toContain("shouldReduceMotion");
  });
});
