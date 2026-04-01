import { test, expect } from "../fixtures/test.fixture";

test.describe("Alert Management", () => {
  test("should display alert events in history tab", async ({
    page,
    alertsPage,
    sidebar,
  }) => {
    await sidebar.navigateTo("Alerts");
    await page.waitForLoadState("networkidle");

    await alertsPage.switchToHistoryTab();

    await alertsPage.expectAlertEventsVisible();
  });

  test("should acknowledge a firing alert", async ({
    page,
    alertsPage,
    sidebar,
  }) => {
    await sidebar.navigateTo("Alerts");
    await page.waitForLoadState("networkidle");

    await alertsPage.switchToHistoryTab();
    await alertsPage.expectAlertEventsVisible();

    await alertsPage.acknowledgeAlert();
    await alertsPage.expectAlertAcknowledged();

    const ackBadges = alertsPage.getAlertStatusBadges();
    await expect(ackBadges.first()).toBeVisible();
  });
});
