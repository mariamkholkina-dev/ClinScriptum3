/**
 * vitest setup: load apps/api/.env.test для integration tests.
 *
 * Не использует пакет dotenv (нет в deps) — minimal inline parser.
 * НЕ перезаписывает уже выставленные env vars: на CI `.github/workflows/ci.yml`
 * выставляет DATABASE_URL → loader не трогает; на dev — берёт из .env.test.
 *
 * cleanupTestData() в helpers.ts проверяет DATABASE_URL содержит "_test" в имени —
 * если по ошибке dev-URL попадёт в process.env, тесты упадут с понятной ошибкой.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  const envPath = resolve(__dirname, ".env.test");
  const content = readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.test missing — test will use existing process.env;
  // assertSafeTestDatabase() will block destructive ops if DB name doesn't match.
}
