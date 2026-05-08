import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardLayoutSource = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");
const analyticsPageSource = readFileSync("src/app/(dashboard)/analytics/page.tsx", "utf8");
const environmentDetailSource = readFileSync("src/app/(dashboard)/environments/[id]/page.tsx", "utf8");
const appSidebarSource = readFileSync("src/components/app-sidebar.tsx", "utf8");

describe("dashboard chrome layout", () => {
  it("keeps the expanded search bar ahead of the team and environment selectors in the header", () => {
    const teamIndex = dashboardLayoutSource.indexOf("<TeamSelector />");
    const environmentIndex = dashboardLayoutSource.indexOf("<EnvironmentSelector />");
    const searchIndex = dashboardLayoutSource.indexOf("onClick={triggerCommandPalette}");

    expect(searchIndex).toBeGreaterThan(-1);
    expect(teamIndex).toBeGreaterThan(searchIndex);
    expect(environmentIndex).toBeGreaterThan(teamIndex);
    expect(dashboardLayoutSource).toContain("min-w-[320px]");
  });

  it("keeps team selection in the header only", () => {
    expect(dashboardLayoutSource).toContain("<TeamSelector />");
    expect(appSidebarSource).not.toContain("<TeamSelector />");
  });

  it("keeps analytics volume content inset from the sidebar like other dashboard pages", () => {
    expect(analyticsPageSource).toContain('className="min-h-full bg-bg text-fg"');
    expect(analyticsPageSource).toContain('className="space-y-6 p-4"');
  });

  it("keeps environment detail content inset from the sidebar like other dashboard pages", () => {
    expect(environmentDetailSource).toContain('className="min-h-full bg-bg text-fg"');
    expect(environmentDetailSource).toContain('className="space-y-5 p-4"');
  });

  it("uses matching compact trigger sizing for team and environment selectors", () => {
    const teamSelectorSource = readFileSync("src/components/team-selector.tsx", "utf8");
    const environmentSelectorSource = readFileSync("src/components/environment-selector.tsx", "utf8");
    expect(teamSelectorSource).toContain("h-7");
    expect(teamSelectorSource).toContain("font-mono text-[12px]");
    expect(environmentSelectorSource).toContain("h-7 min-w-[150px]");
  });
});
