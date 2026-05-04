import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    root: "src",
    fileParallelism: false,
    // Integration tests touch Prisma + several Express middlewares per
    // case and routinely take 4–6s. Default 5000ms is too tight; bump
    // both per-test and per-hook timeouts to 30s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Loads .env.test before any test imports — safe defaults for local dev.
    // CI's process.env already has DATABASE_URL set; setup respects existing vars.
    setupFiles: [resolve(__dirname, "vitest.setup.ts")],
  },
});
