import { test, expect } from "../fixtures/test.fixture";

test.describe("Pipeline Deploy", () => {
  test("should open deploy dialog and submit deployment", async ({
    page,
    pipelineEditor,
    deployDialog,
  }) => {
    const fs = await import("fs/promises");
    const seedResult = JSON.parse(
      await fs.readFile("e2e/.auth/seed-result.json", "utf-8"),
    );

    await pipelineEditor.goto(seedResult.pipelineId);

    await pipelineEditor.clickDeploy();

    await deployDialog.expectOpen();

    await deployDialog.expectEnvironmentOption("e2e-test-env");

    await deployDialog.clickDeploy();

    await deployDialog.waitForDeployComplete();
  });

  test("should show deployment badge on pipeline list after deploy", async ({
    page,
    pipelinesPage,
    sidebar,
  }) => {
    await sidebar.navigateTo("Pipelines");
    await page.waitForLoadState("networkidle");

    await pipelinesPage.expectPipelineInList("E2E Test Pipeline");
  });
});
