import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardDir = join(__dirname, "..");

function readPage(relativePath: string) {
  return readFileSync(join(dashboardDir, relativePath), "utf8");
}

describe("residual v2 page fixes", () => {
  it("renders the cost trend with spend semantics instead of volume semantics", () => {
    const source = readPage("analytics/costs/page.tsx");

    expect(source).toContain("Raw vs reduced spend");
    expect(source).toContain("No spend data for selected range.");
    expect(source).toContain("rawSpendCents");
    expect(source).not.toContain("Raw vs reduced volume");
    expect(source).not.toContain("aria-label={`Raw and reduced volume over ${range}`}");
  });

  it("renders alert environment sync as a designed preview frame without emoji icons", () => {
    const source = readPage("alerts/new/page.tsx");

    expect(source).toContain("Alert rule preview");
    expect(source).toContain("Environment context is syncing");
    expect(source).toContain("VFIcon name=\"bell\"");
    expect(source).not.toContain("🚨");
    expect(source).not.toContain("✅");
    expect(source).not.toContain("⚠️");
  });

  it("does not render an inert promotion detail panel when no rows are available", () => {
    const source = readPage("promotions/page.tsx");

    expect(source).toContain("No promotions match this view");
    expect(source).toContain("visibleRows.length === 0 ? (");
    expect(source).toContain("lg:grid-cols-[1fr_480px]");
    expect(source).not.toContain("Select a promotion");
    expect(source).not.toContain("title=\"Nothing here\"");
  });

  it("does not implicitly filter audit activity by the global team selector", () => {
    const source = readPage("audit/page.tsx");

    expect(source).toContain("const effectiveTeamId = teamFilter || undefined;");
    expect(source).toContain("const selectedAuditTeamId = selectedAuditEntry?.teamId ?? effectiveTeamId ?? null;");
    expect(source).toContain("No audit entries match the current filters");
    expect(source).not.toContain("const effectiveTeamId = teamFilter || selectedTeamId;");
  });
});
