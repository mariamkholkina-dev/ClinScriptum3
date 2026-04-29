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

export async function cleanupTestData() {
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
