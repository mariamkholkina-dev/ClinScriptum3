import { test, expect } from "@playwright/test";

const TEST_EMAIL = "admin@demo.clinscriptum.com";
const TEST_PASSWORD = "changeme123";

test.describe("authentication", () => {
  test("login page shows email and password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("input[type=email]")).toBeVisible();
    await expect(page.locator("input[type=password]")).toBeVisible();
    await expect(page.locator("button[type=submit]")).toBeVisible();
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type=email]", TEST_EMAIL);
    await page.fill("input[type=password]", TEST_PASSWORD);
    await page.click("button[type=submit]");

    await page.waitForURL("**/dashboard", { timeout: 10_000 });
    await expect(page).toHaveURL(/dashboard/);
  });

  test("invalid credentials show error message", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type=email]", "bad@example.com");
    await page.fill("input[type=password]", "wrong");
    await page.click("button[type=submit]");

    await expect(page.locator("text=Invalid credentials")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/login/);
  });

  test("unauthenticated access redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 10_000 });
    await expect(page).toHaveURL(/login/);
  });

  test("logout returns to login page", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type=email]", TEST_EMAIL);
    await page.fill("input[type=password]", TEST_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });

    const logoutBtn = page.locator('button:has-text("Выйти"), button:has-text("Logout"), [data-testid="logout"]');
    if (await logoutBtn.count() > 0) {
      await logoutBtn.first().click();
      await page.waitForURL("**/login", { timeout: 10_000 });
      await expect(page).toHaveURL(/login/);
    }
  });
});
