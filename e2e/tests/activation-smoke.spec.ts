import { test } from "../fixtures/test.fixture";
import { TEST_ENVIRONMENT, TEST_NODE, TEST_USER } from "../helpers/constants";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Activation smoke", () => {
  test("logs in, creates and deploys a minimal pipeline, and observes healthy fleet state", async ({
    page,
    loginPage,
    pipelinesPage,
    pipelineEditor,
    deployDialog,
    fleetPage,
    sidebar,
  }) => {
    const pipelineName = `Activation Smoke ${Date.now()}`;

    await loginPage.goto();
    await loginPage.login(TEST_USER.email, TEST_USER.password);
    await loginPage.expectRedirectedToDashboard();
    await sidebar.expectVisible();

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
    await deployDialog.expectEnvironmentOption(TEST_ENVIRONMENT.name);
    await deployDialog.expectNodeListed(TEST_NODE.name);
    await deployDialog.clickDeploy();
    await deployDialog.waitForDeployComplete();

    await sidebar.navigateTo("Pipelines");
    await pipelinesPage.expectPipelineInList(pipelineName);
    await pipelinesPage.expectDeploymentBadge(pipelineName);

    await sidebar.navigateTo("Fleet");
    await page.waitForLoadState("networkidle");
    await fleetPage.expectNodeInList(TEST_NODE.name);
    await fleetPage.expectNodeStatus(TEST_NODE.name, "Healthy");
  });
});
