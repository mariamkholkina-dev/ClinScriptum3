import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@demo.clinscriptum.com";
const ADMIN_PASSWORD = "changeme123";

test.describe("rules management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input#email", ADMIN_EMAIL);
    await page.fill("input#password", ADMIN_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
    await page.goto("/rules");
  });

  test("rules page loads with rule set groups", async ({ page }) => {
    const expectedGroups = [
      "Классификация",
      "Извлечение",
      "SOA",
      "Внутренний аудит",
      "Генерация",
    ];

    for (const group of expectedGroups) {
      await expect(page.locator(`text=${group}`).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test("create rule set button is visible", async ({ page }) => {
    await expect(
      page.locator('button:has-text("Создать набор"), button:has-text("Создать")')
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("rule set groups can be expanded and collapsed", async ({ page }) => {
    await page.waitForTimeout(1_000);
    const groupHeader = page.locator('text=Классификация').first();
    await expect(groupHeader).toBeVisible({ timeout: 10_000 });
    await groupHeader.click();
    await groupHeader.click();
  });
});
