import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@demo.clinscriptum.com";
const ADMIN_PASSWORD = "changeme123";

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input#email", ADMIN_EMAIL);
    await page.fill("input#password", ADMIN_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
  });

  test("displays page heading", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Панель качества");
  });

  test("shows four stat cards", async ({ page }) => {
    const labels = [
      "Эталонные образцы",
      "Запуски оценки",
      "Ожидают согласования",
      "Необработанные корректировки",
    ];

    for (const label of labels) {
      await expect(page.locator(`text=${label}`)).toBeVisible({ timeout: 10_000 });
    }
  });

  test("shows quick action links", async ({ page }) => {
    await expect(page.locator('a:has-text("Запустить оценку")')).toBeVisible();
    await expect(page.locator('a:has-text("Загрузить эталонный образец")')).toBeVisible();
  });

  test("shows recent evaluation runs section", async ({ page }) => {
    await expect(page.locator("h2")).toContainText("Последние запуски оценки");
  });

  test("quick action links navigate correctly", async ({ page }) => {
    await page.locator('a:has-text("Запустить оценку")').click();
    await expect(page).toHaveURL(/\/evaluation/);

    await page.goBack();
    await page.locator('a:has-text("Загрузить эталонный образец")').click();
    await expect(page).toHaveURL(/\/golden-dataset/);
  });
});
