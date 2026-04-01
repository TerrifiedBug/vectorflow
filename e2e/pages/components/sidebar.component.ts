import { type Page, type Locator } from "@playwright/test";

export class SidebarComponent {
  private readonly sidebar: Locator;

  constructor(private page: Page) {
    this.sidebar = page.locator('[data-slot="sidebar"]');
  }

  async navigateTo(title: string): Promise<void> {
    await this.sidebar.getByRole("link", { name: title }).click();
  }

  async expectVisible(): Promise<void> {
    await this.sidebar.waitFor({ state: "visible" });
  }

  getNavLink(title: string): Locator {
    return this.sidebar.getByRole("link", { name: title });
  }
}
