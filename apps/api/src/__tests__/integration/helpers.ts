import { prisma } from "@clinscriptum/db";
import { appRouter } from "../../routers/index.js";
import type { Context } from "../../trpc/context.js";
import type { JwtPayload } from "@clinscriptum/shared";

export function createCaller(user: JwtPayload | null = null) {
  const ctx: Context = { user };
  return appRouter.createCaller(ctx);
}

export async function registerUser(
  email: string,
  password: string,
  name: string,
  tenantName: string,
) {
  const caller = createCaller();
  return caller.auth.register({ email, password, name, tenantName });
}

/**
 * Safety guard: cleanupTestData делает `TRUNCATE TABLE x CASCADE` для ВСЕХ
 * таблиц в схеме public. Если случайно запустится на dev/prod БД — wipe-ает
 * ВСЕ данные.
 *
 * 2026-05-02: data-loss инцидент: integration tests запускались на dev БД
 * `clinscriptum3` (нет отдельной test-DB), `npm test` стирал данные при
 * каждом запуске. Detection: postgres log_statement=all показал
 * `EXECUTE 'TRUNCATE TABLE x CASCADE'` за окно когда dev данные исчезли.
 * См. project_known_bugs.md.
 *
 * Чтобы это больше не повторилось — guard требует чтобы DATABASE_URL явно
 * указывал на test-БД (содержит "_test" в имени) ИЛИ выставлен env-флаг
 * ALLOW_DESTRUCTIVE_TEST_CLEANUP=1 для CI с явно изолированной БД.
 */
const TEST_DB_NAME_PATTERN = /(_test|_test_\d+|test_)/i;

function assertSafeTestDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    throw new Error("cleanupTestData: DATABASE_URL is empty — refusing to TRUNCATE");
  }
  if (process.env.ALLOW_DESTRUCTIVE_TEST_CLEANUP === "1") return;

  const dbName = url.replace(/\?.*$/, "").split("/").pop() ?? "";
  if (!TEST_DB_NAME_PATTERN.test(dbName)) {
    throw new Error(
      `cleanupTestData: DATABASE_URL ('${dbName}') не похоже на test-DB. ` +
      `Ожидается имя содержащее '_test'. Установите ALLOW_DESTRUCTIVE_TEST_CLEANUP=1 ` +
      `если уверены что это изолированная БД.`,
    );
  }
}

export async function cleanupTestData() {
  assertSafeTestDatabase();
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE t text;
    BEGIN
      FOR t IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      LOOP
        EXECUTE 'TRUNCATE TABLE "' || t || '" CASCADE';
      END LOOP;
    END $$;
  `);
}

export { prisma };
