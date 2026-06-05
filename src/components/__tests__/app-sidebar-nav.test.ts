import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app sidebar navigation", () => {
  it("keeps Analytics as the only sidebar entry while exposing promotions and incidents there", () => {
    const sidebarSource = readFileSync("src/components/app-sidebar.tsx", "utf8");
    const commandPaletteSource = readFileSync("src/components/command-palette.tsx", "utf8");

    expect(sidebarSource).not.toContain('title: "Costs"');
    expect(sidebarSource).toContain('title: "Analytics"');
    expect(sidebarSource).not.toContain('title: "Costs"');
    expect(sidebarSource).toContain('title: "Incidents"');
    expect(sidebarSource).toContain('href: "/incidents"');
    expect(sidebarSource).toContain('title: "Promotions"');
    expect(sidebarSource).toContain('href: "/promotions"');
    expect(commandPaletteSource).toContain('title: "Costs"');
    expect(commandPaletteSource).toContain('href: "/analytics/costs"');
  });

  it("promotes Secrets into the Configure sidebar group", () => {
    const sidebarSource = readFileSync("src/components/app-sidebar.tsx", "utf8");

    expect(sidebarSource).toContain('title: "Secrets"');
    expect(sidebarSource).toContain('href: "/secrets"');
    const commandPaletteSource = readFileSync("src/components/command-palette.tsx", "utf8");
    expect(commandPaletteSource).toContain('href: "/secrets"');
  });

  it("gates the Lake nav entry on the lake being enabled", () => {
    const sidebarSource = readFileSync("src/components/app-sidebar.tsx", "utf8");
    // The Lake entry exists…
    expect(sidebarSource).toContain('href: "/lake"');
    // …but is filtered out unless the server reports the lake is enabled.
    expect(sidebarSource).toContain("lake.status");
    expect(sidebarSource).toContain('item.href === "/lake"');
  });
});
