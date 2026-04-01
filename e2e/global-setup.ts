import { test as setup } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma";
import { seed } from "./helpers/seed";
import { cleanup } from "./helpers/cleanup";
import { TEST_USER } from "./helpers/constants";

const authFile = "e2e/.auth/user.json";

setup("seed database and authenticate", async ({ page }) => {
  const prisma = new PrismaClient();

  try {
    await cleanup(prisma);
    const result = await seed(prisma);

    const fs = await import("fs/promises");
    await fs.writeFile(
      "e2e/.auth/seed-result.json",
      JSON.stringify(result, null, 2),
    );
  } finally {
    await prisma.$disconnect();
  }

  await page.goto("/login");
  await page.getByRole("button", { name: /sign in/i }).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await page.getByRole("textbox", { name: /email/i }).fill(TEST_USER.email);
  await page.locator('input[type="password"]').fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL("**/*", { timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
