import { type Page, type Locator, expect } from "@playwright/test";

export class AlertsPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/alerts");
    await this.page.waitForLoadState("networkidle");
  }

  async switchToHistoryTab(): Promise<void> {
    await this.page.getByRole("tab", { name: /history/i }).click();
    await this.page.waitForLoadState("networkidle");
  }

  async expectAlertEventsVisible(): Promise<void> {
    const eventRows = this.page.locator("tr").filter({ hasText: /firing|resolved|acknowledged/i });
    await expect(eventRows.first()).toBeVisible({ timeout: 10_000 });
  }

  findFiringAlert(): Locator {
    return this.page.locator("tr").filter({ hasText: /firing/i }).first();
  }

  async acknowledgeAlert(): Promise<void> {
    const firingRow = this.page.locator("tr").filter({ hasText: /firing/i }).first();

    const ackButton = firingRow.getByRole("button", { name: /acknowledge/i });
    if (await ackButton.isVisible()) {
      await ackButton.click();
    } else {
      await firingRow.getByRole("button", { name: /open menu|more/i }).click();
      await this.page.getByRole("menuitem", { name: /acknowledge/i }).click();
    }
  }

  async expectAlertAcknowledged(): Promise<void> {
    await this.page.waitForResponse(
      (resp) => resp.url().includes("trpc") && resp.status() === 200,
      { timeout: 5_000 }
    );
    await this.page.waitForTimeout(500);
  }

  getAlertStatusBadges(): Locator {
    return this.page.locator("tr").filter({ hasText: /acknowledged/i });
  }
}
