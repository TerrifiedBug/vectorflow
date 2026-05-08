import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pendingRouteFiles = [
  "src/app/(dashboard)/settings/auth/page.tsx",
  "src/app/(dashboard)/settings/roles/page.tsx",
];

describe("pending settings routes", () => {
  it("redirects pending-design settings surfaces back to the settings hub", () => {
    for (const file of pendingRouteFiles) {
      const source = readFileSync(file, "utf8");

      expect(source).toContain('from "next/navigation"');
      expect(source).toContain('redirect("/settings")');
      expect(source).not.toContain("not yet designed");
    }
  });

  it("renders the approved users management route", () => {
    const source = readFileSync("src/app/(dashboard)/settings/users/page.tsx", "utf8");

    expect(source).toContain('from "./_client"');
    expect(source).not.toContain('redirect("/settings")');
    expect(source).not.toContain("not yet designed");
  });

  it("does not expose pending-design auth or role routes from global shortcuts or readiness links", () => {
    const commandPaletteSource = readFileSync("src/components/command-palette.tsx", "utf8");
    const settingsRouterSource = readFileSync("src/server/routers/settings.ts", "utf8");

    for (const source of [commandPaletteSource, settingsRouterSource]) {
      expect(source).not.toContain('href: "/settings/auth"');
      expect(source).not.toContain('href: "/settings/roles"');
    }
  });
});
