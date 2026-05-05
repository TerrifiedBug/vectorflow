import { expect, test } from "@playwright/test";
import { readSeedResult } from "../helpers/scenario-utils";

test.describe("Editor smoke", () => {
  test("renders the v2 editor shell and node inspector", async ({ page }) => {
    const seed = await readSeedResult();

    await page.goto(`/pipelines/${seed.pipelineId}`);

    const canvas = page.locator(".react-flow");
    await expect(canvas).toBeVisible();
    await expect(canvas.locator(".react-flow__node")).toHaveCount(3);
    await expect(canvas.locator(".react-flow__edge")).toHaveCount(2);

    await expect(page.getByText(/valid/i).first()).toBeVisible();
    await expect(page.getByText(/live tail/i)).toBeVisible();

    await canvas.locator(".react-flow__node", { hasText: "Remap" }).click();
    await expect(page.getByRole("tab", { name: /config/i })).toBeVisible();
    await expect(page.locator("#display-name")).toBeVisible();
    await expect(page.getByText(/component id/i)).toBeVisible();
  });
});
