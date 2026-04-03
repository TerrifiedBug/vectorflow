import { test, expect } from "../fixtures/test.fixture";
import { createLargePipeline } from "../helpers/scenario-utils";

test.describe("Large Pipeline", () => {
  test("should render a 50+ node pipeline", async ({ pipelineEditor }) => {
    const { pipelineId } = await createLargePipeline(55);

    await pipelineEditor.goto(pipelineId);
    const nodes = pipelineEditor.getCanvasNodes();
    await expect(nodes).toHaveCount(55);
  });

  test("should load a large pipeline within acceptable time", async ({ pipelineEditor }) => {
    const { pipelineId } = await createLargePipeline(60);
    const startedAt = Date.now();

    await pipelineEditor.goto(pipelineId);
    await pipelineEditor.expectNodeCount(60);

    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeLessThan(15_000);
  });

  test("should allow saving after editing a large pipeline", async ({ pipelineEditor, toast, page }) => {
    const { pipelineId } = await createLargePipeline(52);

    await pipelineEditor.goto(pipelineId);
    await pipelineEditor.addNodeFromPalette("transform", "remap");
    await pipelineEditor.save();

    await expect(page.locator("[data-sonner-toaster]")).toContainText(/Pipeline saved|success/i);
    await toast.expectSuccess();
  });
});
