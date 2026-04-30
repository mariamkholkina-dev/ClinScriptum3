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

test.describe("studies", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("studies page loads", async ({ page }) => {
    await page.goto("/studies");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/studies/);
  });

  test("study list displays studies or empty state", async ({ page }) => {
    await page.goto("/studies");
    await page.waitForLoadState("networkidle");

    const studyCards = page.locator('[data-testid="study-card"], table tbody tr, .study-item');
    const emptyState = page.locator('text=нет исследований, text=No studies, text=Создайте');

    const hasStudies = await studyCards.count() > 0;
    const hasEmptyState = await emptyState.count() > 0;

    expect(hasStudies || hasEmptyState).toBe(true);
  });

  test("navigate to study detail", async ({ page }) => {
    await page.goto("/studies");
    await page.waitForLoadState("networkidle");

    const firstStudyLink = page.locator('a[href*="/studies/"]').first();
    if (await firstStudyLink.count() > 0) {
      await firstStudyLink.click();
      await page.waitForURL("**/studies/**", { timeout: 10_000 });
      await expect(page).toHaveURL(/studies\/.+/);
    }
  });
});
