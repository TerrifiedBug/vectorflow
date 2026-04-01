import { type Page, type Locator, expect } from "@playwright/test";

export class LoginPage {
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly submitButton: Locator;
  private readonly errorContainer: Locator;

  constructor(private page: Page) {
    this.emailInput = page.getByRole("textbox", { name: /email/i });
    this.passwordInput = page.locator('input[type="password"]');
    this.submitButton = page.getByRole("button", { name: /sign in/i });
    this.errorContainer = page.locator(".bg-destructive\\/10");
  }

  async goto(): Promise<void> {
    await this.page.goto("/login");
    await this.submitButton.waitFor({ state: "visible", timeout: 10_000 });
  }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async expectRedirectedToDashboard(): Promise<void> {
    await this.page.waitForURL("**/*", { timeout: 10_000 });
    await expect(this.page).not.toHaveURL(/\/login/);
  }

  async expectError(message?: string): Promise<void> {
    await expect(this.errorContainer.first()).toBeVisible();
    if (message) {
      await expect(this.errorContainer.first()).toContainText(message);
    }
  }

  async logout(): Promise<void> {
    const userButton = this.page.locator('[data-slot="sidebar"] footer button').first();
    await userButton.click();
    await this.page.getByRole("menuitem", { name: /sign out/i }).click();
  }
}
