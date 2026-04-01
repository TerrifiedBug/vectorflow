import { type Page, type Locator, expect } from "@playwright/test";

export class ToastComponent {
  private readonly toaster: Locator;

  constructor(private page: Page) {
    this.toaster = page.locator("[data-sonner-toaster]");
  }

  async expectSuccess(message?: string): Promise<void> {
    const toast = this.toaster.locator('[data-type="success"]');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
    if (message) {
      await expect(toast.first()).toContainText(message);
    }
  }

  async expectError(message?: string): Promise<void> {
    const toast = this.toaster.locator('[data-type="error"]');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
    if (message) {
      await expect(toast.first()).toContainText(message);
    }
  }

  async expectToastWithText(text: string): Promise<void> {
    await expect(
      this.toaster.locator(`li:has-text("${text}")`).first()
    ).toBeVisible({ timeout: 5000 });
  }
}
