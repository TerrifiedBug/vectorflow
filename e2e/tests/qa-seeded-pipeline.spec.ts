import { expect, test } from "@playwright/test";

test("renders the seeded QA pipeline canvas with nodes", async ({ page }) => {
  await page.goto("/pipelines/qa-pipeline/edit");

  const canvas = page.locator(".react-flow");
  await expect(canvas).toBeVisible();
  await expect(canvas.locator(".react-flow__node")).toHaveCount(2);
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByText("QA Seed Pipeline")).toBeVisible();
});
