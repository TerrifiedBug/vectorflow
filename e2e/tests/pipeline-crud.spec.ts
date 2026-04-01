import { test } from "../fixtures/test.fixture";

test.describe("Pipeline CRUD", () => {
  test("should create a pipeline with source, transform, and sink nodes", async ({
    page,
    pipelinesPage,
    pipelineEditor,
    sidebar,
  }) => {
    await sidebar.navigateTo("Pipelines");
    await page.waitForLoadState("networkidle");

    await pipelinesPage.clickNewPipeline();

    await pipelineEditor.addNodeFromPalette("source", "demo_logs");
    await pipelineEditor.expectNodeCount(1);

    await pipelineEditor.addNodeFromPalette("transform", "remap");
    await pipelineEditor.expectNodeCount(2);

    await pipelineEditor.addNodeFromPalette("sink", "blackhole");
    await pipelineEditor.expectNodeCount(3);

    await pipelineEditor.save();
    await pipelineEditor.expectSaveSuccess();
  });

  test("should persist pipeline nodes after reload", async ({
    pipelineEditor,
  }) => {
    const fs = await import("fs/promises");
    const seedResult = JSON.parse(
      await fs.readFile("e2e/.auth/seed-result.json", "utf-8"),
    );

    await pipelineEditor.goto(seedResult.pipelineId);

    await pipelineEditor.expectNodeCount(3);
  });

  test("should delete a pipeline from the list", async ({
    pipelinesPage,
    sidebar,
  }) => {
    await sidebar.navigateTo("Pipelines");
    await page.waitForLoadState("networkidle");

    await pipelinesPage.expectPipelineInList("E2E Test Pipeline");

    await pipelinesPage.deletePipeline("E2E Test Pipeline");

    await pipelinesPage.expectPipelineNotInList("E2E Test Pipeline");
  });
});
