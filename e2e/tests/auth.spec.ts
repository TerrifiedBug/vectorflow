import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/login.page";
import { SidebarComponent } from "../pages/components/sidebar.component";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Authentication", () => {
  test("should log in with valid credentials and redirect to dashboard", async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const sidebar = new SidebarComponent(page);

    await loginPage.goto();
    await loginPage.login("e2e@test.local", "TestPassword123!");
    await loginPage.expectRedirectedToDashboard();
    await sidebar.expectVisible();
  });

  test("should show error for invalid credentials", async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto();
    await loginPage.login("e2e@test.local", "WrongPassword!");
    await loginPage.expectError("Invalid email or password");
  });

  test("should redirect unauthenticated users to login", async ({ page }) => {
    await page.goto("/pipelines");
    await expect(page).toHaveURL(/\/login/);
  });

  test("should log out and redirect to login", async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto();
    await loginPage.login("e2e@test.local", "TestPassword123!");
    await loginPage.expectRedirectedToDashboard();

    await loginPage.logout();
    await expect(page).toHaveURL(/\/login/);
  });
});
