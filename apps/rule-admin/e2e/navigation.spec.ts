import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@demo.clinscriptum.com";
const ADMIN_PASSWORD = "changeme123";

test.describe("sidebar navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input#email", ADMIN_EMAIL);
    await page.fill("input#password", ADMIN_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
  });

  test("sidebar shows navigation items", async ({ page }) => {
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();

    const expectedItems = [
      "Панель управления",
      "Эталонный набор",
      "Оценка качества",
      "Расхождения",
      "Корректировки",
      "Правила и промпты",
      "Аудит обработок",
      "Бандлы конфигурации",
      "SOA",
      "Пакетное тестирование",
      "Настройка LLM",
      "Настройки обработки",
    ];

    for (const item of expectedItems) {
      await expect(sidebar.locator(`a:has-text("${item}")`)).toBeVisible();
    }
  });

  test("clicking nav item navigates to correct page", async ({ page }) => {
    await page.locator('a:has-text("Правила и промпты")').click();
    await expect(page).toHaveURL(/\/rules/);

    await page.locator('a:has-text("Эталонный набор")').click();
    await expect(page).toHaveURL(/\/golden-dataset/);

    await page.locator('a:has-text("Настройка LLM")').click();
    await expect(page).toHaveURL(/\/llm-config/);
  });

  test("active nav item is highlighted", async ({ page }) => {
    const dashboardLink = page.locator('a[href="/dashboard"]');
    await expect(dashboardLink).toHaveClass(/bg-brand-50/);
  });

  test("sidebar can be collapsed and expanded", async ({ page }) => {
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/w-64/);

    const collapseBtn = sidebar.locator("button").first();
    await collapseBtn.click();
    await expect(sidebar).toHaveClass(/w-16/);

    await collapseBtn.click();
    await expect(sidebar).toHaveClass(/w-64/);
  });

  test("sidebar header shows app title", async ({ page }) => {
    await expect(page.locator("aside")).toContainText("Администрирование правил");
  });
});
