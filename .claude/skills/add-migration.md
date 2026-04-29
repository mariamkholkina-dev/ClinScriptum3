---
name: add-migration
description: Create and apply a Prisma migration
---

Arguments: <migration-name> <description-of-changes>

Steps:

1. Edit `packages/db/prisma/schema.prisma` with the requested changes
2. Run: `npx prisma migrate dev --name <migration-name> --schema=packages/db/prisma/schema.prisma`
3. Run: `npm run db:generate`
4. Run: `npm run typecheck` to verify all packages compile
5. If typecheck fails due to new required fields, update affected services

Follow existing schema patterns. Use `@default()` for new required columns on existing tables.
