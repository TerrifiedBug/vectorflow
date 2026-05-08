import { describe, expect, it } from "vitest";
import { settingsNavGroups } from "@/components/settings-sidebar-nav";

describe("settings sidebar nav", () => {
  it("exposes Users while hiding settings surfaces that are still pending design", () => {
    const exposedTitles = settingsNavGroups.flatMap((group) =>
      group.items.filter((item) => !item.designHidden).map((item) => item.title),
    );

    expect(exposedTitles).not.toContain("Authentication");
    expect(exposedTitles).toContain("Users");
  });

  it("does not expose Secrets in settings navigation", () => {
    const secretsItem = settingsNavGroups
      .flatMap((group) => group.items)
      .find((item) => item.title === "Secrets");

    expect(secretsItem).toBeUndefined();
  });
});
