# API Server

Express + tRPC v11, SuperJSON transformer. Port 4000.

## Adding a new feature

### New service
1. Create `src/services/{name}.service.ts`
2. Export singleton: `export const {name}Service = new {Name}Service()`
3. Add to `src/services/index.ts`
4. Use `DomainError` for errors (NOT `TRPCError` directly)
5. Use `requireTenantResource(resource, tenantId)` for tenant isolation

### New router
1. Create `src/routers/{name}.ts`
2. Import and add to `src/routers/index.ts` → `appRouter`
3. Use `protectedProcedure` for authenticated endpoints
4. Input validation via `.input(z.object({...}))`
5. Delegate all logic to service layer — router is thin

### New migration
1. Edit `packages/db/prisma/schema.prisma`
2. Run `npx prisma migrate dev --name descriptive_name`
3. Run `npm run db:generate`
4. Verify: `npm run typecheck`

## Patterns

- Error handling: throw `DomainError` → `withDomainErrors` middleware maps to `TRPCError`
- Tenant guard: `requireTenantResource(resource, tenantId)` — throws FORBIDDEN if mismatch
- Context: `getRequestContext()` from `@clinscriptum/shared` — returns `{ tenantId, userId, correlationId }`
- Logging: `import { logger } from '../lib/logger.js'` — never use `console.*`
- Inter-audit pairs: any service method taking `(protocolVersionId, checkedVersionId)` must call `validateInterAuditPair()` first (validates tenant + `document.type='protocol'` + same `studyId` for both)
- Global-vs-tenant resources (`RuleSet` etc.): `where: { OR: [{ tenantId }, { tenantId: null }] }` + `orderBy: { tenantId: { sort: "desc", nulls: "last" } }`
- Cursor pagination on list endpoints with potentially large results: optional `take` (1..500) + `cursor` (UUID) input, `take + 1` query, return `nextCursor`. Without `take`/`cursor` — back-compat full list. Pattern: see `audit.service.getAuditFindings`

## Tests

- Location: `src/__tests__/` (integration), `src/lib/__tests__/` (unit), `src/services/__tests__/` (service)
- Framework: Vitest
- Run: `npx vitest run` or `npm test --workspace=@clinscriptum/api`

### Integration tests use a dedicated test-DB

`cleanupTestData()` in `__tests__/integration/helpers.ts` does `TRUNCATE TABLE x CASCADE`
on every table in schema `public` — must run on a separate DB, never on dev `clinscriptum3`.

`apps/api/.env.test` (committed) sets `DATABASE_URL=postgresql://...clinscriptum3_test` and
`vitest.config.ts` loads it via `setupFiles: [vitest.setup.ts]`. CI's own env-vars take
precedence (the loader skips already-set vars).

**First-time local setup:**
```bash
docker compose exec postgres createdb -U clinscriptum clinscriptum3_test
DATABASE_URL=postgresql://clinscriptum:clinscriptum_dev@localhost:5432/clinscriptum3_test \
  npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
```

**Defense-in-depth:** `assertSafeTestDatabase()` inside `cleanupTestData()` throws if
`DATABASE_URL` doesn't contain `_test` and `ALLOW_DESTRUCTIVE_TEST_CLEANUP=1` is unset.
This catches missing `.env.test` setup before any `TRUNCATE` runs.
