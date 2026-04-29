import { test, expect } from "@playwright/test";

const TEST_EMAIL = "admin@demo.clinscriptum.com";
const TEST_PASSWORD = "changeme123";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("input[type=email]", TEST_EMAIL);
  await page.fill("input[type=password]", TEST_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard", { timeout: 10_000 });
}

test.describe("visual regression", () => {
  test("login page", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("login.png");
  });

  test("dashboard", async ({ page }) => {
    await login(page);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("dashboard.png", {
      mask: [page.locator("time, [data-testid='timestamp']")],
    });
  });

  test("studies list", async ({ page }) => {
    await login(page);
    await page.goto("/studies");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("studies.png");
  });
});
