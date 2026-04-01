import { test, expect } from "../fixtures/test.fixture";

test.describe("Fleet Management", () => {
  test("should display fleet node list with correct status", async ({
    page,
    fleetPage,
    sidebar,
  }) => {
    await sidebar.navigateTo("Fleet");
    await page.waitForLoadState("networkidle");

    await fleetPage.expectNodeInList("e2e-node-01");

    await fleetPage.expectNodeStatus("e2e-node-01", "Healthy");
  });

  test("should navigate to node detail page", async ({
    page,
    fleetPage,
    sidebar,
  }) => {
    await sidebar.navigateTo("Fleet");
    await page.waitForLoadState("networkidle");

    await fleetPage.openNodeDetail("e2e-node-01");

    await fleetPage.expectNodeDetailInfo({
      host: "e2e-host-01.local",
      agentVersion: "1.0.0",
      os: "linux",
    });
  });

  test("should navigate back to fleet list from node detail", async ({
    page,
    fleetPage,
    sidebar,
  }) => {
    await sidebar.navigateTo("Fleet");
    await page.waitForLoadState("networkidle");

    await fleetPage.openNodeDetail("e2e-node-01");
    await fleetPage.navigateBackToFleet();

    await fleetPage.expectNodeInList("e2e-node-01");
  });
});
