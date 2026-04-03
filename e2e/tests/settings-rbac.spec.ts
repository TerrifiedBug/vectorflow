import { test, expect } from "../fixtures/test.fixture";
import { createUserWithRole, readSeedResult } from "../helpers/scenario-utils";

test.describe("Settings RBAC", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("should hide Settings navigation for VIEWER", async ({ loginPage, sidebar }) => {
    const viewer = await createUserWithRole("VIEWER");

    await loginPage.goto();
    await loginPage.login(viewer.email, viewer.password);
    await loginPage.expectRedirectedToDashboard();

    await expect(sidebar.getNavLink("Settings")).not.toBeVisible();
  });

  test("should hide Settings navigation for EDITOR", async ({ loginPage, sidebar }) => {
    const editor = await createUserWithRole("EDITOR");

    await loginPage.goto();
    await loginPage.login(editor.email, editor.password);
    await loginPage.expectRedirectedToDashboard();

    await expect(sidebar.getNavLink("Settings")).not.toBeVisible();
  });

  test("should prevent VIEWER from saving pipeline edits", async ({
    loginPage,
    page,
    pipelineEditor,
    toast,
  }) => {
    const viewer = await createUserWithRole("VIEWER");
    const seed = await readSeedResult();

    await loginPage.goto();
    await loginPage.login(viewer.email, viewer.password);
    await loginPage.expectRedirectedToDashboard();

    await pipelineEditor.goto(seed.pipelineId);
    await pipelineEditor.addNodeFromPalette("transform", "remap");
    await pipelineEditor.save();

    await toast.expectError();
    await expect(page.locator("[data-sonner-toaster]")).toContainText(/requires EDITOR role|forbidden|unauthorized/i);
  });
});
