import { test, expect } from "../fixtures/test.fixture";

test.describe("Backup & Restore", () => {
  test("should create a backup, import it, show warnings, and restore round-trip", async ({
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
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Import the downloaded dump so the restore preflight exercises imported-backup warnings.
    await page.locator('input[type="file"][accept=".dump"]').setInputFiles(downloadPath!);
    await expect(page.getByText("Backup imported successfully")).toBeVisible({
      timeout: 30_000,
    });

    const importedRow = page
      .locator("tr", { has: page.getByText("Imported") })
      .filter({ has: page.getByText("Success") })
      .first();
    await expect(importedRow).toBeVisible({ timeout: 15_000 });

    // Open restore dialog for the imported backup.
    await importedRow.locator("td").last().getByRole("button", { name: /restore/i }).click();

    // Preview step: imported backups warn about encryption compatibility and require acknowledgement.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Encryption key compatibility unknown")).toBeVisible({
      timeout: 15_000,
    });
    const continueBtn = dialog.getByRole("button", {
      name: /continue to confirmation/i,
    });
    await expect(continueBtn).toBeDisabled();
    await dialog.getByLabel(/I understand the warnings/i).check();
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    // Confirm step: type the required confirmation word
    await dialog.locator("#restore-confirm-input").fill("RESTORE");
    await dialog.getByRole("button", { name: /restore database/i }).click();

    // Done step: restore completed with the enhanced result panel
    await expect(
      dialog.getByText(/Database restored successfully from backup taken on/i),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      dialog.getByText(/Restart the application for changes to take full effect/i),
    ).toBeVisible();

    await dialog.getByRole("button", { name: /close/i }).click();
    await expect(dialog).not.toBeVisible();
  });
});
