import { test, expect } from "../fixtures/test.fixture";

test.describe("Backup & Restore", () => {
  test("should create a backup, download it, and restore round-trip", async ({
    page,
  }) => {
    await page.goto("/settings/backup");
    await page.waitForLoadState("networkidle");

    // Trigger a manual backup
    await page.getByRole("button", { name: /create backup now/i }).click();
    await expect(page.getByText("Backup created successfully")).toBeVisible({
      timeout: 30_000,
    });

    // Wait for a Success row to appear in the backup table
    const successRow = page
      .locator("tr", { has: page.getByText("Success") })
      .first();
    await expect(successRow).toBeVisible({ timeout: 15_000 });

    // Download — the download button is icon-only (first action button in the row)
    const actionsCell = successRow.locator("td").last();
    const downloadPromise = page.waitForEvent("download");
    await actionsCell.locator("button").first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().length).toBeGreaterThan(0);

    // Open restore dialog
    await actionsCell.getByRole("button", { name: /restore/i }).click();

    // Preview step: wait for metadata to load then advance
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const continueBtn = dialog.getByRole("button", {
      name: /continue to confirmation/i,
    });
    await expect(continueBtn).toBeEnabled({ timeout: 15_000 });
    await continueBtn.click();

    // Confirm step: type the required confirmation word
    await dialog.locator("#restore-confirm-input").fill("RESTORE");
    await dialog.getByRole("button", { name: /restore database/i }).click();

    // Done step: restore completed
    await expect(
      dialog.getByText("Database restored successfully"),
    ).toBeVisible({ timeout: 30_000 });

    await dialog.getByRole("button", { name: /close/i }).click();
    await expect(dialog).not.toBeVisible();
  });
});
