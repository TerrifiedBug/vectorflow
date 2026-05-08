import { test as setup } from "@playwright/test";
import { seed } from "./helpers/seed";
import { cleanup } from "./helpers/cleanup";
import { TEST_USER } from "./helpers/constants";
import { createE2ePrismaClient } from "./helpers/prisma";

const authFile = "e2e/.auth/user.json";

setup("seed database and authenticate", async ({ page }) => {
  const prisma = createE2ePrismaClient();

  try {
    await cleanup(prisma);
    const result = await seed(prisma);

    const fs = await import("fs/promises");
    await fs.mkdir("e2e/.auth", { recursive: true });
    await fs.writeFile(
      "e2e/.auth/seed-result.json",
      JSON.stringify(result, null, 2),
    );
  } finally {
    await prisma.$disconnect();
  }

  await page.goto("/login");
  const submitButton = page.getByRole("button", { name: /continue|sign in/i });
  await submitButton.waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await page.getByRole("textbox", { name: /email/i }).fill(TEST_USER.email);
  await page.locator('input[type="password"]').fill(TEST_USER.password);
  await submitButton.click();

  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
