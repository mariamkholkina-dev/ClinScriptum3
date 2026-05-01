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
