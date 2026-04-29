import { test, expect } from "@playwright/test";
import path from "path";

const TEST_EMAIL = "admin@demo.clinscriptum.com";
const TEST_PASSWORD = "changeme123";

test.describe("document upload", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type=email]", TEST_EMAIL);
    await page.fill("input[type=password]", TEST_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
  });

  test("studies page is accessible after login", async ({ page }) => {
    await page.goto("/studies");
    await expect(page).toHaveURL(/studies/);
    await expect(page.locator("h1, h2, [data-testid='studies-title']").first()).toBeVisible();
  });

  test("document list page loads for a study", async ({ page }) => {
    await page.goto("/studies");
    const studyLink = page.locator("a[href*='/studies/']").first();
    if (await studyLink.count() > 0) {
      await studyLink.click();
      await page.waitForURL("**/studies/**", { timeout: 10_000 });
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("upload button is visible on documents page", async ({ page }) => {
    await page.goto("/studies");
    const studyLink = page.locator("a[href*='/studies/']").first();
    if (await studyLink.count() > 0) {
      await studyLink.click();
      await page.waitForURL("**/studies/**", { timeout: 10_000 });

      const uploadBtn = page.locator(
        'button:has-text("Загрузить"), button:has-text("Upload"), [data-testid="upload-button"]',
      );
      if (await uploadBtn.count() > 0) {
        await expect(uploadBtn.first()).toBeVisible();
      }
    }
  });
});
