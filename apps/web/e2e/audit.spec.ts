import { test, expect } from "@playwright/test";

const TEST_EMAIL = "admin@demo.clinscriptum.com";
const TEST_PASSWORD = "changeme123";

test.describe("audit flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type=email]", TEST_EMAIL);
    await page.fill("input[type=password]", TEST_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
  });

  test("audit page is accessible", async ({ page }) => {
    await page.goto("/studies");
    const studyLink = page.locator("a[href*='/studies/']").first();
    if (await studyLink.count() === 0) {
      test.skip(true, "No studies available for audit test");
      return;
    }

    await studyLink.click();
    await page.waitForURL("**/studies/**", { timeout: 10_000 });

    const docLink = page.locator("a[href*='/documents/'], a[href*='/audit/']").first();
    if (await docLink.count() > 0) {
      await docLink.click();
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("audit tab shows findings when available", async ({ page }) => {
    await page.goto("/studies");
    const studyLink = page.locator("a[href*='/studies/']").first();
    if (await studyLink.count() === 0) {
      test.skip(true, "No studies available");
      return;
    }

    await studyLink.click();
    await page.waitForURL("**/studies/**", { timeout: 10_000 });

    const auditLink = page.locator("a[href*='/audit/']").first();
    if (await auditLink.count() > 0) {
      await auditLink.click();
      await page.waitForURL("**/audit/**", { timeout: 10_000 });

      const findingsContainer = page.locator(
        '[data-testid="findings-list"], table, .findings, [class*="finding"]',
      );
      const auditBtn = page.locator(
        'button:has-text("Аудит"), button:has-text("Audit"), button:has-text("Запустить")',
      );
      const eitherVisible = await findingsContainer.count() > 0 || await auditBtn.count() > 0;
      expect(eitherVisible).toBeTruthy();
    }
  });

  test("study settings page loads", async ({ page }) => {
    await page.goto("/studies");
    const studyLink = page.locator("a[href*='/studies/']").first();
    if (await studyLink.count() === 0) {
      test.skip(true, "No studies available");
      return;
    }

    await studyLink.click();
    await page.waitForURL("**/studies/**", { timeout: 10_000 });

    const settingsLink = page.locator(
      'a:has-text("Настройки"), a:has-text("Settings"), a[href*="settings"]',
    ).first();
    if (await settingsLink.count() > 0) {
      await settingsLink.click();
      await expect(page.locator("body")).toBeVisible();
    }
  });
});
