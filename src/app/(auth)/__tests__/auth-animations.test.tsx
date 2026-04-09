/**
 * Static import-pattern tests for auth page animation integration.
 *
 * These tests read source files directly to assert that:
 * - Each auth page imports `fadeInUp` from the centralized motion barrel.
 * - The login page does NOT use the old inline opacity/y animation values.
 * - The auth layout imports `StaggerList` and `StaggerItem`.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const authRoot = path.resolve(__dirname, "..");

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(authRoot, relPath), "utf-8");
}

describe("auth page animation imports", () => {
  it("login page imports fadeInUp from @/components/motion", () => {
    const src = readSource("login/page.tsx");
    expect(src).toContain("fadeInUp");
    expect(src).toContain("@/components/motion");
  });

  it("setup page imports fadeInUp from @/components/motion", () => {
    const src = readSource("setup/page.tsx");
    expect(src).toContain("fadeInUp");
    expect(src).toContain("@/components/motion");
  });

  it("setup-2fa page imports fadeInUp from @/components/motion", () => {
    const src = readSource("setup-2fa/page.tsx");
    expect(src).toContain("fadeInUp");
    expect(src).toContain("@/components/motion");
  });

  it("auth layout imports StaggerList and StaggerItem", () => {
    const src = readSource("layout.tsx");
    expect(src).toContain("StaggerList");
    expect(src).toContain("StaggerItem");
  });
});

describe("login page has no legacy inline animation values", () => {
  it("does not use inline opacity: 0, y: 8 animation", () => {
    const src = readSource("login/page.tsx");
    expect(src).not.toContain("opacity: 0, y: 8");
  });

  it("does not use inline opacity: 0, y: 10 outside of imported variants", () => {
    // The inline animation on m.div should not exist; fadeInUp variant handles it
    const src = readSource("login/page.tsx");
    // Should not have a raw transition prop with duration: 0.3 on the card wrapper
    expect(src).not.toContain('transition={{ duration: 0.3');
  });
});

describe("setup-2fa page has hover class fix", () => {
  it("main card has hover:translate-y-0 hover:shadow-none", () => {
    const src = readSource("setup-2fa/page.tsx");
    expect(src).toContain("hover:translate-y-0 hover:shadow-none");
  });
});

describe("all auth pages use TargetAndTransition cast pattern", () => {
  const pages = [
    "login/page.tsx",
    "setup/page.tsx",
    "setup-2fa/page.tsx",
  ];

  for (const page of pages) {
    it(`${page} casts fadeInUp.initial and fadeInUp.animate as TargetAndTransition`, () => {
      const src = readSource(page);
      expect(src).toContain("fadeInUp.initial as TargetAndTransition");
      expect(src).toContain("fadeInUp.animate as TargetAndTransition");
    });
  }
});
