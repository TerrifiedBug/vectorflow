import { expect, test } from "@playwright/test";
import { readSeedResult } from "../helpers/scenario-utils";

test.describe("Pipeline detail and dashboard", () => {
  test("renders pipeline detail with edit CTA and dependency summary", async ({ page }) => {
    const seed = await readSeedResult();

    await page.goto(`/pipelines/${seed.pipelineId}`);

    await expect(page.getByRole("heading", { name: /e2e test pipeline/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /edit pipeline/i })).toHaveAttribute(
      "href",
      `/pipelines/${seed.pipelineId}/edit`,
    );
    await expect(page.getByText(/topology/i)).toBeVisible();
    await expect(page.getByText(/dependencies/i)).toBeVisible();
  });

  test("renders dashboard seven-tile KPI row including CPU heatmap", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
    await expect(page.getByText(/total nodes/i)).toBeVisible();
    await expect(page.getByText(/cpu heatmap/i)).toBeVisible();
    await expect(page.getByText(/active alerts/i)).toBeVisible();
  });
});
