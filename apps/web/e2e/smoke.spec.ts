import { test, expect } from "@playwright/test";

test.describe("smoke tests", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("text=ClinScriptum")).toBeVisible();
    await expect(page.locator("input[type=email]")).toBeVisible();
    await expect(page.locator("input[type=password]")).toBeVisible();
  });

  test("register page loads", async ({ page }) => {
    await page.goto("/register");
    await expect(page.locator("text=ClinScriptum")).toBeVisible();
  });

  test("rejects login with wrong credentials", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type=email]", "wrong@example.com");
    await page.fill("input[type=password]", "wrongpassword");
    await page.click("button[type=submit]");

    await expect(page.locator("text=Invalid credentials")).toBeVisible({ timeout: 10_000 });
  });

  test("login → dashboard → studies flow", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type=email]", "admin@demo.clinscriptum.com");
    await page.fill("input[type=password]", "changeme123");
    await page.click("button[type=submit]");

    await page.waitForURL("**/dashboard", { timeout: 10_000 });
    await expect(page).toHaveURL(/dashboard/);

    const studiesLink = page.locator('a[href*="studies"], nav >> text=Исследовани');
    if (await studiesLink.count() > 0) {
      await studiesLink.first().click();
      await page.waitForURL("**/studies", { timeout: 10_000 });
      await expect(page).toHaveURL(/studies/);
    }
  });

  test("unauthenticated user is redirected from dashboard", async ({ page }) => {
    await page.goto("/dashboard");

    await page.waitForURL("**/login", { timeout: 10_000 });
    await expect(page).toHaveURL(/login/);
  });
});
