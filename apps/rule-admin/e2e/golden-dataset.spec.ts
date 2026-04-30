import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@demo.clinscriptum.com";
const ADMIN_PASSWORD = "changeme123";

test.describe("golden dataset", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input#email", ADMIN_EMAIL);
    await page.fill("input#password", ADMIN_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
    await page.goto("/golden-dataset");
  });

  test("golden dataset page loads", async ({ page }) => {
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });
  });

  test("filter controls are visible", async ({ page }) => {
    await expect(page.locator("select").first()).toBeVisible({ timeout: 10_000 });
  });

  test("create sample button is visible", async ({ page }) => {
    await expect(
      page.locator('button:has-text("Создать"), button:has-text("Добавить")')
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("batch import button is visible", async ({ page }) => {
    await expect(
      page.locator('button:has-text("Импорт"), button:has-text("Загрузить")')
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
