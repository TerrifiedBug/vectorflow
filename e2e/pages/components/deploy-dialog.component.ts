import { type Page, type Locator, expect } from "@playwright/test";

export class DeployDialogComponent {
  private readonly dialog: Locator;

  constructor(private page: Page) {
    this.dialog = page.getByRole("dialog");
  }

  async expectOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible();
  }

  async expectEnvironmentOption(envName: string): Promise<void> {
    await expect(this.dialog.getByText(envName)).toBeVisible();
  }

  async expectNodeListed(nodeName: string): Promise<void> {
    await expect(this.dialog.getByText(nodeName)).toBeVisible();
  }

  async clickDeploy(): Promise<void> {
    await this.dialog.getByRole("button", { name: /deploy/i }).click();
  }

  async waitForDeployComplete(): Promise<void> {
    await this.page.waitForResponse(
      (resp) => resp.url().includes("trpc") && resp.status() === 200,
      { timeout: 15_000 }
    );
  }
}
