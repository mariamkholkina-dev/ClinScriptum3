import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@demo.clinscriptum.com";
const ADMIN_PASSWORD = "changeme123";

test.describe("authentication", () => {
  test("login page shows email, password and submit button", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("input#email")).toBeVisible();
    await expect(page.locator("input#password")).toBeVisible();
    await expect(page.locator("button[type=submit]")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Администрирование правил");
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input#email", ADMIN_EMAIL);
    await page.fill("input#password", ADMIN_PASSWORD);
    await page.click("button[type=submit]");

    await page.waitForURL("**/dashboard", { timeout: 10_000 });
    await expect(page).toHaveURL(/dashboard/);
  });

  test("invalid credentials show error", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input#email", "bad@example.com");
    await page.fill("input#password", "wrong");
    await page.click("button[type=submit]");

    await expect(page.locator(".bg-red-50")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/login/);
  });

  test("unauthenticated access redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 10_000 });
    await expect(page).toHaveURL(/login/);
  });

  test("logout returns to login page", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input#email", ADMIN_EMAIL);
    await page.fill("input#password", ADMIN_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard", { timeout: 10_000 });

    await page.locator("button", { hasText: "Выход" }).click();
    await page.waitForURL("**/login", { timeout: 10_000 });
    await expect(page).toHaveURL(/login/);
  });
});
