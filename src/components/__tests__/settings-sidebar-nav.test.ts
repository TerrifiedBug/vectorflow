import { describe, it, expect, vi, afterEach } from "vitest";
import { settingsNavGroups } from "../settings-sidebar-nav";

const allItems = settingsNavGroups.flatMap((g) => g.items);

function filterItems(opts: { isSuperAdmin: boolean; isAdmin: boolean; demoMode: boolean }) {
  return settingsNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (opts.demoMode && item.demoHidden) return false;
        if (item.requiredSuperAdmin) return opts.isSuperAdmin;
        return opts.isAdmin;
      }),
    }))
    .filter((group) => group.items.length > 0);
}

describe("settingsNavGroups", () => {
  it("exports all four groups", () => {
    expect(settingsNavGroups.map((g) => g.label)).toEqual(["System", "Security", "Organization", "Operations"]);
  });

  it("every item has title, href, icon, description", () => {
    for (const item of allItems) {
      expect(item.title).toBeTruthy();
      expect(item.href).toMatch(/^\/settings\//);
      expect(item.icon).toBeTruthy();
      expect(item.description).toBeTruthy();
    }
  });

  it("every group has a description", () => {
    for (const group of settingsNavGroups) {
      expect(group.description).toBeTruthy();
    }
  });
});

describe("settings nav visibility", () => {
  it("super-admin sees all groups", () => {
    const groups = filterItems({ isSuperAdmin: true, isAdmin: true, demoMode: false });
    expect(groups.map((g) => g.label)).toEqual(["System", "Security", "Organization", "Operations"]);
  });

  it("super-admin sees all items", () => {
    const groups = filterItems({ isSuperAdmin: true, isAdmin: true, demoMode: false });
    const titles = groups.flatMap((g) => g.items.map((i) => i.title));
    expect(titles).toContain("Version Check");
    expect(titles).toContain("Authentication");
    expect(titles).toContain("All Teams");
    expect(titles).toContain("Telemetry");
    expect(titles).toContain("Users");
    expect(titles).toContain("My Team");
    expect(titles).toContain("Fleet");
  });

  it("team-admin sees non-super-admin items only", () => {
    const groups = filterItems({ isSuperAdmin: false, isAdmin: true, demoMode: false });
    const titles = groups.flatMap((g) => g.items.map((i) => i.title));
    expect(titles).not.toContain("Version Check");
    expect(titles).not.toContain("Authentication");
    expect(titles).not.toContain("Fleet");
    expect(titles).toContain("My Team");
    expect(titles).toContain("Service Accounts");
    expect(titles).toContain("AI");
  });

  it("demo-mode hides demoHidden items even for super-admin", () => {
    const groups = filterItems({ isSuperAdmin: true, isAdmin: true, demoMode: true });
    const titles = groups.flatMap((g) => g.items.map((i) => i.title));
    expect(titles).not.toContain("Telemetry");
    expect(titles).not.toContain("Users");
    expect(titles).not.toContain("My Team");
    expect(titles).not.toContain("Service Accounts");
    expect(titles).not.toContain("Outbound Webhooks");
    expect(titles).toContain("Version Check");
    expect(titles).toContain("Authentication");
    expect(titles).toContain("AI");
  });

  it("non-admin sees no settings items", () => {
    const groups = filterItems({ isSuperAdmin: false, isAdmin: false, demoMode: false });
    expect(groups).toHaveLength(0);
  });
});
