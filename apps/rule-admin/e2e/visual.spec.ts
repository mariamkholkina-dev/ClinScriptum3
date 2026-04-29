import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@demo.clinscriptum.com";
const ADMIN_PASSWORD = "changeme123";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("input#email", ADMIN_EMAIL);
  await page.fill("input#password", ADMIN_PASSWORD);
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

  test("rules page", async ({ page }) => {
    await login(page);
    await page.goto("/rules");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("rules.png");
  });

  test("golden dataset page", async ({ page }) => {
    await login(page);
    await page.goto("/golden-dataset");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("golden-dataset.png");
  });

  test("sidebar collapsed", async ({ page }) => {
    await login(page);
    const collapseBtn = page.locator("aside button").first();
    await collapseBtn.click();
    await expect(page.locator("aside")).toHaveClass(/w-16/);
    await expect(page).toHaveScreenshot("sidebar-collapsed.png");
  });

  test("llm config page", async ({ page }) => {
    await login(page);
    await page.goto("/llm-config");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("llm-config.png");
  });
});
