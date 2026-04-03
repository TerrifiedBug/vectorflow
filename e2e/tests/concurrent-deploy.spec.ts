import { test, expect } from "../fixtures/test.fixture";
import { readSeedResult } from "../helpers/scenario-utils";

test.describe("Concurrent Deploy", () => {
  test("should show conflict message when another deploy is in progress", async ({
    page,
    pipelineEditor,
    deployDialog,
    toast,
  }) => {
    const seed = await readSeedResult();
    await pipelineEditor.goto(seed.pipelineId);

    await page.route("**/api/trpc/deploy.agent**", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "A pending deploy request already exists for this pipeline" }),
      });
    });

    await pipelineEditor.clickDeploy();
    await deployDialog.expectOpen();
    await page.locator("#changelog").fill("Concurrent deploy test");
    await page
      .getByRole("button", { name: /publish to agents|request deploy|deploy to canary nodes/i })
      .click();

    await toast.expectError();
  });

  test("should keep deploy dialog open after conflict for resolution", async ({
    page,
    pipelineEditor,
    deployDialog,
  }) => {
    const seed = await readSeedResult();
    await pipelineEditor.goto(seed.pipelineId);

    await page.route("**/api/trpc/deploy.agent**", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Conflict" }),
      });
    });

    await pipelineEditor.clickDeploy();
    await deployDialog.expectOpen();
    await page.locator("#changelog").fill("Keep dialog open after conflict");
    await page
      .getByRole("button", { name: /publish to agents|request deploy|deploy to canary nodes/i })
      .click();

    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("should allow a second submit attempt after a conflict", async ({
    page,
    pipelineEditor,
    deployDialog,
  }) => {
    const seed = await readSeedResult();
    await pipelineEditor.goto(seed.pipelineId);

    let attempts = 0;
    await page.route("**/api/trpc/deploy.agent**", async (route) => {
      attempts += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Conflict" }),
      });
    });

    await pipelineEditor.clickDeploy();
    await deployDialog.expectOpen();

    const reason = page.locator("#changelog");
    const button = page.getByRole("button", {
      name: /publish to agents|request deploy|deploy to canary nodes/i,
    });

    await reason.fill("First attempt");
    await button.click();

    await reason.fill("Second attempt");
    await button.click();

    await expect.poll(() => attempts).toBe(2);
  });
});
