import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSidebarSource = readFileSync("src/components/app-sidebar.tsx", "utf8");
const faviconSource = readFileSync("src/app/icon.svg", "utf8");

describe("branding assets", () => {
  it("uses the larger sidebar wordmark size to better fill the header space", () => {
    expect(appSidebarSource).toContain("<VFLogo size={24} />");
  });

  it("keeps the sidebar logo row aligned with the main header divider", () => {
    expect(appSidebarSource).toContain('<SidebarHeader className="gap-0 p-0">');
    expect(appSidebarSource).toContain("flex h-13 items-center");
  });

  it("uses the spec-style hex and chevron favicon instead of the old vf lettermark", () => {
    expect(faviconSource).toContain("M14 1.5L25.5 8v12L14 26.5 2.5 20V8L14 1.5z");
    expect(faviconSource).toContain('stroke="#7dd957"');
    expect(faviconSource).not.toContain('<!-- V -->');
  });
});
