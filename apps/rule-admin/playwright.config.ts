import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://localhost:3002",
    headless: true,
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  webServer: [
    {
      command: "npm run dev --workspace=@clinscriptum/api",
      port: 4000,
      reuseExistingServer: true,
      cwd: "../..",
    },
    {
      command: "npm run dev --workspace=@clinscriptum/rule-admin",
      port: 3002,
      reuseExistingServer: true,
      cwd: "../..",
    },
  ],
});
