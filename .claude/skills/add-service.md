---
name: add-service
description: Scaffold a new API service with router and tests
---

Arguments: <service-name> <description>

Create the following files:

1. `apps/api/src/services/<service-name>.service.ts`:
   - Class with constructor taking PrismaClient
   - Export singleton instance
   - Import `DomainError` from `./errors.js`
   - Import `requireTenantResource` from `./tenant-guard.js`
   - Import `getRequestContext` from `@clinscriptum/shared`
   - Import `logger` from `../lib/logger.js`

2. `apps/api/src/routers/<service-name>.ts`:
   - Import service from services
   - Create router with `protectedProcedure`
   - Wrap in `withDomainErrors` middleware

3. Register in `apps/api/src/routers/index.ts`:
   - Add import
   - Add to `appRouter` object

4. `apps/api/src/services/__tests__/<service-name>.service.test.ts`:
   - Basic test structure with vitest

5. Run `npm run typecheck` to verify.

Follow existing patterns in `apps/api/src/services/study.service.ts` and `apps/api/src/routers/study.ts`.
