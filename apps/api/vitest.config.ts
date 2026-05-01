import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    root: "src",
    fileParallelism: false,
    // Loads .env.test before any test imports — safe defaults for local dev.
    // CI's process.env already has DATABASE_URL set; setup respects existing vars.
    setupFiles: [resolve(__dirname, "vitest.setup.ts")],
  },
});
