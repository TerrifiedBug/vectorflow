import { type Page, expect } from "@playwright/test";

export class PipelinesPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/pipelines");
    await this.page.waitForLoadState("networkidle");
  }

  async clickNewPipeline(): Promise<void> {
    await this.page.getByRole("link", { name: /new pipeline/i }).click();
    await this.page.waitForURL("**/pipelines/new");
  }

  async expectPipelineInList(name: string): Promise<void> {
    await expect(this.page.getByRole("link", { name })).toBeVisible();
  }

  async expectPipelineNotInList(name: string): Promise<void> {
    await expect(this.page.getByRole("link", { name })).not.toBeVisible();
  }

  async openPipeline(name: string): Promise<void> {
    await this.page.getByRole("link", { name }).click();
    await this.page.waitForURL("**/pipelines/**");
  }

  async deletePipeline(name: string): Promise<void> {
    const row = this.page.locator("tr", { hasText: name });
    await row.getByRole("button", { name: /open menu|more/i }).click();
    await this.page.getByRole("menuitem", { name: /delete/i }).click();
    await this.page.getByRole("dialog").getByRole("button", { name: /delete|confirm/i }).click();
  }

  async expectDeploymentBadge(pipelineName: string): Promise<void> {
    const row = this.page.locator("tr", { hasText: pipelineName });
    await expect(row).not.toContainText("Draft");
  }
}
