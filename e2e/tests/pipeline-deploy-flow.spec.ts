import { test } from "../fixtures/test.fixture";

test.describe("Pipeline Create → Deploy → Active", () => {
  test("should create a pipeline, deploy it, and show active status in list", async ({
    pipelinesPage,
    pipelineEditor,
    deployDialog,
    sidebar,
  }) => {
    const pipelineName = `Deploy Flow ${Date.now()}`;

    await sidebar.navigateTo("Pipelines");
    await pipelinesPage.clickNewPipeline();

    await pipelineEditor.setName(pipelineName);
    await pipelineEditor.addNodeFromPalette("source", "demo_logs");
    await pipelineEditor.addNodeFromPalette("sink", "blackhole");
    await pipelineEditor.connectNodes("demo_logs", "blackhole");
    await pipelineEditor.save();
    await pipelineEditor.expectSaveSuccess();

    await pipelineEditor.clickDeploy();
    await deployDialog.expectOpen();
    await deployDialog.clickDeploy();
    await deployDialog.waitForDeployComplete();

    await sidebar.navigateTo("Pipelines");
    await pipelinesPage.expectPipelineInList(pipelineName);
    await pipelinesPage.expectDeploymentBadge(pipelineName);
  });
});
