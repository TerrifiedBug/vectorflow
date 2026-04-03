import { test, expect } from "../fixtures/test.fixture";
import { readSeedResult } from "../helpers/scenario-utils";

test.describe("E2E Error Handling", () => {
  test("should surface API save errors in a toast", async ({ pipelineEditor, toast, page }) => {
    const seed = await readSeedResult();
    await pipelineEditor.goto(seed.pipelineId);

    await page.route("**/api/trpc/pipeline.saveGraph**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced save failure" }),
      });
    });

    await pipelineEditor.addNodeFromPalette("transform", "remap");
    await pipelineEditor.save();
    await toast.expectError();
  });

  test("should show retry UI after pipeline load failure", async ({ page }) => {
    const seed = await readSeedResult();
    let firstFailure = true;

    await page.route("**/api/trpc/pipeline.get**", async (route) => {
      if (firstFailure) {
        firstFailure = false;
        await route.fulfill({ status: 504, body: "gateway timeout" });
        return;
      }
      await route.continue();
    });

    await page.goto(`/pipelines/${seed.pipelineId}`);
    await expect(page.getByText(/Failed to load pipeline/i)).toBeVisible();
    await page.getByRole("button", { name: /try again/i }).click();
    await expect(page.locator(".react-flow")).toBeVisible();
  });

  test("should allow retrying deploy after a transient failure", async ({
    page,
    pipelineEditor,
    deployDialog,
    toast,
  }) => {
    const seed = await readSeedResult();
    await pipelineEditor.goto(seed.pipelineId);

    let deployAttempts = 0;
    await page.route("**/api/trpc/deploy.agent**", async (route) => {
      deployAttempts += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "transient deploy failure" }),
      });
    });

    await pipelineEditor.clickDeploy();
    await deployDialog.expectOpen();

    const reason = page.locator("#changelog");
    await reason.fill("Retry deploy after transient network error");

    const publishButton = page.getByRole("button", {
      name: /publish to agents|request deploy|deploy to canary nodes/i,
    });
    await publishButton.click();
    await toast.expectError();

    await reason.fill("Second attempt should still be sent");
    await publishButton.click();
    await expect.poll(() => deployAttempts).toBe(2);
  });
});
