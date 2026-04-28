import { type Page, type Locator, expect } from "@playwright/test";

export class PipelineEditorPage {
  private readonly canvas: Locator;

  constructor(private page: Page) {
    this.canvas = page.locator(".react-flow");
  }

  async goto(pipelineId: string): Promise<void> {
    await this.page.goto(`/pipelines/${pipelineId}`);
    await this.canvas.waitFor({ state: "visible" });
  }

  async setName(name: string): Promise<void> {
    const nameInput = this.page.locator('input[name="name"], [data-testid="pipeline-name"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.clear();
      await nameInput.fill(name);
    }
  }

  async addNodeFromPalette(
    kind: "source" | "transform" | "sink",
    componentType: string,
  ): Promise<void> {
    const palette = this.page.locator('[class*="palette"], [data-testid="component-palette"]').first();

    if (!(await palette.isVisible().catch(() => false))) {
      const toggleBtn = this.page.getByRole("button", { name: /add|components|palette/i });
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
      }
    }

    const searchInput = palette.locator('input[placeholder*="Search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill(componentType);
    }

    const componentItem = palette.locator(`[draggable="true"]`, {
      hasText: new RegExp(componentType, "i"),
    }).first();

    await componentItem.dragTo(this.canvas, {
      targetPosition: { x: 400, y: 300 },
    });

    if (await searchInput.isVisible()) {
      await searchInput.clear();
    }
  }

  async expectNodeCount(count: number): Promise<void> {
    const nodes = this.canvas.locator(".react-flow__node");
    await expect(nodes).toHaveCount(count);
  }

  async save(): Promise<void> {
    const saveButton = this.page.getByRole("button", { name: /save/i });
    await saveButton.click();
  }

  async expectSaveSuccess(): Promise<void> {
    await this.page.waitForResponse(
      (resp) => resp.url().includes("trpc") && resp.status() === 200,
      { timeout: 10_000 }
    );
  }

  async clickDeploy(): Promise<void> {
    await this.page.getByRole("button", { name: /deploy/i }).click();
  }

  async connectNodes(sourceLabel: string, targetLabel: string): Promise<void> {
    const src = this.canvas.locator(".react-flow__node", { hasText: sourceLabel }).first();
    const tgt = this.canvas.locator(".react-flow__node", { hasText: targetLabel }).first();
    await src.locator(".react-flow__handle.source").dragTo(
      tgt.locator(".react-flow__handle.target"),
    );
    await expect(this.canvas.locator(".react-flow__edge")).toHaveCount(1);
  }

  getCanvasNodes(): Locator {
    return this.canvas.locator(".react-flow__node");
  }
}
