import { type Page, type Locator, expect } from "@playwright/test";

export class FleetPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/fleet");
    await this.page.waitForLoadState("networkidle");
  }

  async expectNodeInList(nodeName: string): Promise<void> {
    await expect(this.page.getByText(nodeName).first()).toBeVisible();
  }

  async expectNodeStatus(nodeName: string, status: string): Promise<void> {
    const row = this.page.locator("tr", { hasText: nodeName });
    await expect(row.getByText(status, { exact: false })).toBeVisible();
  }

  async openNodeDetail(nodeName: string): Promise<void> {
    await this.page.getByRole("link", { name: nodeName }).click();
    await this.page.waitForURL("**/fleet/**");
  }

  async expectNodeDetailInfo(fields: {
    host?: string;
    agentVersion?: string;
    os?: string;
  }): Promise<void> {
    if (fields.host) {
      await expect(this.page.getByText(fields.host)).toBeVisible();
    }
    if (fields.agentVersion) {
      await expect(this.page.getByText(fields.agentVersion)).toBeVisible();
    }
    if (fields.os) {
      await expect(this.page.getByText(fields.os)).toBeVisible();
    }
  }

  async navigateBackToFleet(): Promise<void> {
    await this.page.goto("/fleet");
  }
}
