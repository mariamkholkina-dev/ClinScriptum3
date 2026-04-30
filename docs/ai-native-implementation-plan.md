# План внедрения AI-Native практик в ClinScriptum

Дата: 2026-04-29
Основан на: `docs/ai-native-analysis.md`

---

## Фаза 0: Стабилизация (день 1)

Цель: привести текущее состояние репозитория в порядок перед внедрением новых практик.

### Шаг 0.1 — Разобрать незакоммиченные изменения

Сейчас в git status ~45 изменённых файлов. Нужно разбить на атомарные коммиты по логическим группам.

```bash
# 1. Посмотреть что изменено
git diff --stat

# 2. Сгруппировать по фичам/фиксам, закоммитить каждую группу отдельно:
# Пример:
git add apps/api/src/services/evaluation.service.ts apps/api/src/routers/evaluation.ts
git commit -m "feat: add evaluation service and router"

git add apps/api/src/lib/rate-limiter.ts
git commit -m "fix: update rate limiter configuration"

# ... и так далее для каждой логической группы
```

Критерий готовности: `git status` чистый, каждый коммит собирается (`npm run build`) и проходит `npm run typecheck`.

### Шаг 0.2 — Почистить settings.local.json

Файл `.claude/settings.local.json` содержит 97 разрешений, многие одноразовые.

Действия:
1. Открыть `.claude/settings.local.json`
2. Удалить одноразовые записи: `find`, `awk`, `sort`, `xargs`, `wmic`, `sqlite3`, `python3`, `nslookup`, `disown`, `echo`, конкретные `curl` проверки, конкретные `git -C` пути, `rm -rf`, `taskkill`
3. Оставить повторяющиеся: `git *`, `npm *`, `npx *`, `curl *`, `docker *`, `node *`, `WebSearch`, `WebFetch(domain:...)` нужные домены

Целевой вид (~20 записей вместо 97):
```json
{
  "permissions": {
    "allow": [
      "Bash(git *)",
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(node *)",
      "Bash(curl *)",
      "Bash(docker *)",
      "Bash(docker compose *)",
      "Bash(tasklist *)",
      "Bash(redis-cli *)",
      "Bash(PGPASSWORD=* psql *)",
      "Read(//tmp/**)",
      "WebSearch",
      "WebFetch(domain:github.com)",
      "WebFetch(domain:deepwiki.com)",
      "WebFetch(domain:yandex.cloud)"
    ]
  }
}
```

---

## Фаза 1: Git Workflow (день 1-2)

Цель: перейти от прямых пушей в master к feature branches + PR.

### Шаг 1.1 — Защитить ветку master на GitHub

```bash
# Через GitHub CLI:
gh api repos/{owner}/{repo}/branches/master/protection -X PUT -f '{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}'
```

Или в GitHub UI: Settings → Branches → Add rule для `master`:
- [x] Require status checks to pass before merging → выбрать "build"
- [ ] Require pull request reviews — не обязательно для solo, но желательно

### Шаг 1.2 — Описать workflow в CLAUDE.md

Добавить секцию в CLAUDE.md:

```markdown
## Git Workflow

- Never push directly to `master`
- Create feature branch: `git checkout -b feat/short-description`
- Naming: `feat/...`, `fix/...`, `refactor/...`, `docs/...`
- Commit with Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Before committing: run `npm run typecheck && npm run lint && npm test`
- Create PR via `gh pr create`, run `/review` before merging
- Squash merge to master
```

### Шаг 1.3 — Добавить Conventional Commits в CLAUDE.md

Добавить в секцию Git Workflow:

```markdown
### Commit message format

```
<type>: <description>

[optional body]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Types: `feat` (new feature), `fix` (bug fix), `refactor` (no behavior change),
`test` (adding tests), `docs` (documentation), `chore` (tooling, deps)
```

---

## Фаза 2: Feedback Loops (день 2-3)

Цель: автоматические проверки качества при каждом изменении кода.

### Шаг 2.1 — Установить husky + lint-staged

```bash
npm install -D husky lint-staged
npx husky init
```

Создать файл `.husky/pre-commit`:
```bash
npx lint-staged
```

Добавить в корневой `package.json`:
```json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix --no-warn-ignored"
    ]
  }
}
```

Проверить:
```bash
git add package.json .husky/pre-commit
git commit -m "chore: add husky and lint-staged for pre-commit checks"
```

### Шаг 2.2 — Настроить Claude Code hooks

Создать файл `.claude/settings.json` (project-level, коммитится в git):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "npx tsc --noEmit --pretty false 2>&1 | head -30"
      }
    ]
  },
  "permissions": {
    "allow": [
      "Bash(npm run typecheck)",
      "Bash(npm run lint)",
      "Bash(npm test)",
      "Bash(npx turbo *)",
      "Bash(npx prisma generate *)",
      "Bash(npx prisma migrate *)",
      "Bash(npx vitest *)",
      "Bash(git status)",
      "Bash(git log *)",
      "Bash(git diff *)",
      "Bash(git branch *)",
      "Bash(git checkout -b *)",
      "Bash(gh pr *)"
    ]
  }
}
```

Что это даёт: после каждого Edit/Write Claude Code автоматически запускает typecheck и видит ошибки — feedback loop без ручного запуска.

### Шаг 2.3 — Добавить verification checklist в CLAUDE.md

Добавить секцию:

```markdown
## Before committing

Always run before creating a commit:
1. `npm run typecheck` — must pass with zero errors
2. `npm run lint` — must pass (warnings OK, errors not)
3. `npm test` — all tests must pass
4. Update `changelog.md` with description of changes (Russian, grouped by date)
```

---

## Фаза 3: CLAUDE.md Enhancement (день 3-4)

Цель: превратить репозиторий в полностью AI-native с детальным контекстом для агента.

### Шаг 3.1 — Добавить Security constraints в корневой CLAUDE.md

Вставить после секции "Observability":

```markdown
### Security

- Never log JWT tokens, API keys, passwords, or patient/clinical data
- All new tRPC procedures must use `verifyAccessToken` middleware (see `apps/api/src/trpc/trpc.ts`)
- Every DB query on tenant data must filter by `tenantId` — use `requireTenantResource()` guard
- All tRPC inputs validated via Zod schemas — never trust raw input
- No `eval()`, no dynamic `require()`, no SQL string concatenation
- File uploads: validate MIME type, enforce size limits, sanitize filenames
```

### Шаг 3.2 — Добавить Common Gotchas в корневой CLAUDE.md

Вставить после секции "Security":

```markdown
### Common gotchas

- After editing `packages/db/prisma/schema.prisma`: run `npm run db:generate` before typecheck
- After adding a new tRPC router: register it in `apps/api/src/routers/index.ts` (import + add to `router({})`)
- ESM: imports in `apps/api` and `apps/workers` require `.js` extension (`import { x } from './file.js'`)
- After adding new service: export from `apps/api/src/services/index.ts`
- Prisma enums: after adding enum value, create migration `npx prisma migrate dev --name add_enum_value`
- Frontend env vars must be prefixed `NEXT_PUBLIC_` to be available in browser
```

### Шаг 3.3 — Создать apps/api/CLAUDE.md

```markdown
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

## Tests

- Location: `src/__tests__/` (integration), `src/lib/__tests__/` (unit), `src/services/__tests__/` (service)
- Framework: Vitest
- Run: `npx vitest run` or `npm test --workspace=@clinscriptum/api`
```

### Шаг 3.4 — Создать apps/web/CLAUDE.md

```markdown
# Web Frontend

Next.js 14 App Router, React 18, Tailwind CSS, Zustand.

## Adding a new page

1. Create `src/app/(app)/{route}/page.tsx`
2. Use `"use client"` directive for interactive pages
3. Data fetching: `trpc.{router}.{procedure}.useQuery()` / `.useMutation()`
4. State: Zustand stores in `src/stores/`

## Patterns

- tRPC client: `import { trpc } from '@/lib/trpc'`
- UI components: `src/components/` — reusable, `src/app/(app)/{route}/` — page-specific
- Styling: Tailwind utility classes, no CSS modules
- Icons: `lucide-react`
- Modals: `src/components/Modal.tsx` wrapper

## Key files

- `src/lib/trpc.ts` — tRPC React Query setup, imports `AppRouter` from API
- `src/app/(app)/layout.tsx` — authenticated layout with sidebar
- `src/middleware.ts` — auth redirect logic
```

### Шаг 3.5 — Создать apps/workers/CLAUDE.md

```markdown
# Workers

BullMQ job processors. No HTTP server.

## Adding a new handler

1. Create `src/handlers/{job-name}.ts`
2. Export async function: `export async function handle{JobName}(job: Job)`
3. Register in `src/index.ts` — add to worker's `process` switch
4. Add retry config in `src/lib/retry-config.ts`
5. Add to orchestrator if part of pipeline: `src/pipeline/orchestrator.ts`

## Patterns

- Each handler wraps work in `asyncContext.run()` with `correlationId` from job data
- Use `logger` (not console) — auto-enriches with job context
- Idempotency: check if step already completed before re-executing
- Storage: `src/api-shared/storage.ts` — shared with API, uses same MinIO/local config
- LLM calls: use `@clinscriptum/llm-gateway` — never call OpenAI/Anthropic directly

## Pipeline order

parse_document → classify_sections → extract_facts → detect_soa → intra_doc_audit
```

### Шаг 3.6 — Создать packages/rules-engine/CLAUDE.md

```markdown
# Rules Engine

Deterministic classification and extraction rules. No LLM calls.

## Structure

- `src/section-classifier/` — classifies document sections by zone (synopsis, objectives, etc.)
- `src/fact-extractor/` — extracts structured facts from section content
- `src/contradiction-detector/` — finds contradictions between facts
- `src/rule-adapter.ts` — loads rules from DB RuleSet system

## Tests

All rules must have tests. Location: `src/__tests__/`

```bash
npx vitest run                    # run all
npx vitest run section-classifier # run specific
```

## Adding a new rule

1. Add pattern/logic in appropriate module
2. Add test case in `src/__tests__/{module}.test.ts`
3. Run `npx vitest run` — must pass
```

---

## Фаза 4: Безопасность (день 4-5)

Цель: усилить security-проверки в CI и коде.

### Шаг 4.1 — Добавить npm audit в CI

Файл: `.github/workflows/ci.yml`

Добавить шаг после `npm ci`:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
      cache: npm
  - run: npm ci
  - run: npm audit --audit-level=high --omit=dev || true   # ← НОВОЕ
  - run: npx prisma generate --schema=packages/db/prisma/schema.prisma
  # ... остальные шаги
```

`|| true` чтобы не ломать билд на первом запуске — потом убрать, когда все known vulns будут зафиксированы или проигнорированы.

### Шаг 4.2 — Написать тесты для rate-limiter

Файл: `apps/api/src/lib/__tests__/rate-limiter.test.ts`

Покрыть сценарии:
- Запрос в пределах лимита — пропускает
- Запрос сверх лимита — отклоняет с 429
- Лимит сбрасывается после окна
- Разные ключи (разные пользователи) — изолированы
- Edge case: одновременные запросы (race condition)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  // ... тесты
});
```

### Шаг 4.3 — Расширить тесты auth

Файл: `apps/api/src/lib/__tests__/auth.test.ts` (уже существует — дополнить)

Добавить edge cases:
- Expired JWT → 401
- Malformed JWT → 401
- Valid JWT но wrong tenantId → 403
- Refresh token flow: valid → new access token
- Refresh token flow: expired refresh → 401
- Role-based access: writer can't access admin endpoints

### Шаг 4.4 — Написать тесты tenant isolation

Файл: `apps/api/src/__tests__/integration/tenant-isolation.test.ts` (уже существует — дополнить)

Добавить:
- Tenant A не может видеть документы Tenant B
- Tenant A не может запустить аудит на документе Tenant B
- Tenant A не может видеть findings Tenant B
- Tenant A не может видеть исследования Tenant B

### Шаг 4.5 — Запустить /security-review

```
# В Claude Code:
/security-review
```

Зафиксировать результаты. Повторять перед каждым релизом.

---

## Фаза 5: Plan & Act процесс (день 5)

Цель: формализовать процесс планирования перед реализацией.

### Шаг 5.1 — Добавить процесс в CLAUDE.md

```markdown
## Development Process (Plan & Act)

For tasks touching >3 files or spanning multiple layers (DB → API → UI):

1. **Plan** — enter `/plan` mode, describe the task, agree on approach
2. **Research** — explore affected files, check existing patterns
3. **Decompose** — break into atomic steps (migration → service → router → UI → tests)
4. **Execute** — implement each step, commit after each with passing checks
5. **Review** — run `/review` on the branch before creating PR
6. **Simplify** — run `/simplify` to check for duplication and quality

For small tasks (<3 files, single layer): skip steps 1-3, go directly to execute.
```

### Шаг 5.2 — Добавить шаблон декомпозиции задач

Добавить в CLAUDE.md:

```markdown
### Task decomposition template

When implementing a feature, follow this order:

1. **Schema** — Prisma model changes + migration + `db:generate`
2. **Service** — business logic in `apps/api/src/services/`
3. **Router** — tRPC endpoints in `apps/api/src/routers/`
4. **Workers** — if async processing needed, add handler + orchestrator step
5. **Frontend** — UI in `apps/web/src/app/(app)/`
6. **Tests** — unit for service, integration for router, component for UI
7. **Docs** — update CLAUDE.md if patterns changed

Each step = separate commit. Each commit must pass typecheck + lint.
```

---

## Фаза 6: Custom Skills (день 6-7)

Цель: создать переиспользуемые skills для типовых задач.

### Шаг 6.1 — Создать skill "verify"

Файл: `.claude/skills/verify.md`

```markdown
---
name: verify
description: Run full verification pipeline (typecheck, lint, test)
---

Run the following checks in order and report results:

1. `npm run typecheck` — TypeScript compilation check
2. `npm run lint` — ESLint check
3. `npm test` — Vitest test suite

Report: for each step, whether it passed or failed.
If any step fails, show the first 20 lines of errors.
```

### Шаг 6.2 — Создать skill "add-service"

Файл: `.claude/skills/add-service.md`

```markdown
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
```

### Шаг 6.3 — Создать skill "add-migration"

Файл: `.claude/skills/add-migration.md`

```markdown
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
```

### Шаг 6.4 — Создать skill "pre-pr"

Файл: `.claude/skills/pre-pr.md`

```markdown
---
name: pre-pr
description: Full pre-PR checklist — verify, review, simplify, then create PR
---

Run the following sequence:

1. **Verify**: run typecheck, lint, test (all must pass)
2. **Review**: analyze all changes on current branch vs master (`git diff master...HEAD`)
   - Check for security issues (SQL injection, XSS, auth bypass, tenant isolation)
   - Check for missing error handling at system boundaries
   - Check for forgotten console.log or debug code
   - Check for hardcoded secrets or credentials
3. **Simplify**: check for code duplication, unnecessary abstractions, dead code
4. **Changelog**: verify `changelog.md` is updated with all changes
5. Report: pass/fail for each step, list of issues found
```

---

## Фаза 7: MCP серверы (день 7-8)

Цель: подключить внешний контекст к Claude Code.

### Шаг 7.1 — Подключить GitHub MCP

Добавить в `.claude/settings.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

Установить `GITHUB_TOKEN` в переменные окружения.

Что даёт: Claude Code сможет работать с issues, PRs, code search на GitHub без `gh` CLI.

### Шаг 7.2 — Подключить PostgreSQL MCP

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"]
    }
  }
}
```

Что даёт: Claude Code сможет проверять текущую структуру БД, выполнять SELECT-запросы для диагностики, без переключения в psql.

### Шаг 7.3 — Подключить Filesystem MCP (для docs)

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./docs"]
    }
  }
}
```

Что даёт: доступ к документации проекта (URS, спецификации) как к контексту.

---

## Фаза 8: Расширение тестов (день 8-14)

Цель: покрыть тестами критические пути. Приоритизация по risk/effort.

### Шаг 8.1 — Тесты сервисного слоя (приоритет 1)

Создать тесты для сервисов, которые содержат критическую бизнес-логику:

| Файл | Что тестировать |
|------|----------------|
| `services/__tests__/document.service.test.ts` | Загрузка, версионирование, удаление документов. Tenant isolation. |
| `services/__tests__/processing.service.test.ts` | Запуск pipeline, статусы, идемпотентность перезапуска. |
| `services/__tests__/audit.service.test.ts` | Запуск аудита, получение findings, фильтрация по типам. |
| `services/__tests__/study.service.test.ts` | CRUD исследований, настройки, tenant isolation. |

Для каждого сервиса:
1. Mock PrismaClient с помощью `vitest.mock()`
2. Тестировать бизнес-правила, не DB-запросы
3. Обязательно тестировать: DomainError при невалидных данных, tenant isolation через `requireTenantResource`

### Шаг 8.2 — Тесты worker handlers (приоритет 2)

| Файл | Что тестировать |
|------|----------------|
| `handlers/__tests__/parse-document.test.ts` | Парсинг DOCX, обработка ошибок, обновление статуса. |
| `handlers/__tests__/classify-sections.test.ts` | Классификация секций, обновление статуса. |
| `handlers/__tests__/extract-facts.test.ts` | Извлечение фактов, 3-level pipeline. |
| `handlers/__tests__/intra-doc-audit.test.ts` | Запуск аудита, сохранение findings. |

Для каждого handler:
1. Mock зависимости (Prisma, LLM gateway, storage)
2. Тестировать happy path + error recovery
3. Тестировать идемпотентность (повторный запуск не дублирует данные)

### Шаг 8.3 — Тесты orchestrator (приоритет 2)

Файл: `apps/workers/src/pipeline/__tests__/orchestrator.test.ts`

- Pipeline запускается корректно
- Шаги выполняются в правильном порядке
- Ошибка на шаге N не выполняет шаг N+1
- Retry перезапускает с failed шага, не с начала
- Статус документа обновляется на каждом шаге

### Шаг 8.4 — Добавить test coverage в CI

Обновить `package.json`:
```json
{
  "scripts": {
    "test": "turbo test",
    "test:coverage": "turbo test -- --coverage"
  }
}
```

Добавить в CI после `turbo test`:
```yaml
- run: npx turbo test -- --coverage --reporter=text
```

Целевое покрытие: >60% для packages, >40% для apps (начальная цель).

---

## Фаза 9: CI усиление (день 14-15)

### Шаг 9.1 — Добавить dependency audit

В `.github/workflows/ci.yml`:
```yaml
- run: npm audit --audit-level=high --omit=dev
```

### Шаг 9.2 — Добавить отдельный security job

```yaml
security:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: npm
    - run: npm ci
    - run: npm audit --audit-level=high --omit=dev
    - name: Check for secrets in code
      run: |
        if grep -rn "password\s*=\s*['\"]" --include="*.ts" apps/ packages/ | grep -v test | grep -v example; then
          echo "::error::Hardcoded passwords found in source code"
          exit 1
        fi
```

### Шаг 9.3 — Добавить Conventional Commits lint (commitlint)

```bash
npm install -D @commitlint/cli @commitlint/config-conventional
```

Создать `commitlint.config.js`:
```javascript
export default { extends: ['@commitlint/config-conventional'] };
```

Добавить husky hook `.husky/commit-msg`:
```bash
npx --no -- commitlint --edit ${1}
```

---

## Фаза 10: E2E тесты (день 15-21)

### Шаг 10.1 — Настроить Playwright

```bash
npm install -D @playwright/test --workspace=@clinscriptum/web
npx playwright install chromium
```

Создать `apps/web/playwright.config.ts`:
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  baseURL: 'http://localhost:3000',
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
  },
});
```

### Шаг 10.2 — Написать E2E тесты для critical paths

| Тест | Сценарий |
|------|---------|
| `e2e/auth.spec.ts` | Логин → dashboard → logout |
| `e2e/document-upload.spec.ts` | Загрузка DOCX → ожидание обработки → просмотр секций |
| `e2e/audit.spec.ts` | Открыть документ → запустить аудит → просмотр findings |
| `e2e/study-crud.spec.ts` | Создать исследование → настроить → удалить |

### Шаг 10.3 — Добавить E2E в CI (опционально)

```yaml
e2e:
  runs-on: ubuntu-latest
  needs: build
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npx playwright install chromium
    - run: npm run build --workspace=@clinscriptum/web
    - run: npx playwright test --project=chromium
```

---

## Фаза 11: Автоматизация рутин (день 21+)

### Шаг 11.1 — Настроить scheduled agent для dependency check

```
/schedule create "weekly-deps" --cron "0 9 * * 1" --prompt "Check for outdated dependencies with npm outdated. If any have major version bumps with security fixes, create a PR updating them. Run typecheck and tests after update."
```

### Шаг 11.2 — Настроить scheduled agent для TODO cleanup

```
/schedule create "todo-sweep" --cron "0 9 1,15 * *" --prompt "Search codebase for TODO, FIXME, HACK comments. Create an issue listing them with file:line, grouped by urgency. Flag any that reference completed features."
```

### Шаг 11.3 — Настроить scheduled agent для security review

```
/schedule create "security-review" --cron "0 9 1 * *" --prompt "Run /security-review on the current main branch. Post results as a GitHub issue."
```

---

## Фаза 12: Observability для AI-кода (день 21+)

### Шаг 12.1 — Скрипт анализа AI-contributed кода

Создать `scripts/ai-contribution-report.sh`:
```bash
#!/bin/bash
echo "=== AI Contribution Report ==="
total=$(git log --oneline | wc -l)
ai=$(git log --format="%b" | grep -c "Co-Authored-By: Claude")
echo "Total commits: $total"
echo "AI-assisted: $ai ($(( ai * 100 / total ))%)"
echo ""
echo "=== Files most changed by AI ==="
git log --format="%H" --grep="Co-Authored-By: Claude" | head -20 | while read h; do
  git diff-tree --no-commit-id --name-only -r $h
done | sort | uniq -c | sort -rn | head -20
```

### Шаг 12.2 — Отслеживание качества AI-кода

Добавить в CI сбор coverage per-file. Сравнивать coverage файлов из AI-коммитов vs manual — следить за трендом.

---

## Сводная таблица по фазам

| Фаза | Срок | Усилие | Что получаем |
|------|------|--------|-------------|
| 0. Стабилизация | день 1 | 2ч | Чистый git status, чистые permissions |
| 1. Git Workflow | день 1-2 | 1ч | Feature branches, PR, conventional commits |
| 2. Feedback Loops | день 2-3 | 2ч | Husky pre-commit, Claude Code hooks, verification checklist |
| 3. CLAUDE.md Enhancement | день 3-4 | 3ч | Per-package docs, security rules, gotchas, templates |
| 4. Безопасность | день 4-5 | 4ч | npm audit в CI, тесты auth/rate-limiter, security-review |
| 5. Plan & Act | день 5 | 0.5ч | Формализованный процесс в CLAUDE.md |
| 6. Custom Skills | день 6-7 | 2ч | 4 skills: verify, add-service, add-migration, pre-pr |
| 7. MCP серверы | день 7-8 | 1ч | GitHub, PostgreSQL, Filesystem MCPs |
| 8. Расширение тестов | день 8-14 | 12ч | Покрытие сервисов, workers, orchestrator, coverage в CI |
| 9. CI усиление | день 14-15 | 2ч | Security job, secrets check, commitlint |
| 10. E2E тесты | день 15-21 | 8ч | Playwright для critical paths |
| 11. Рутины | день 21+ | 1ч | Scheduled agents: deps, TODOs, security |
| 12. Observability | день 21+ | 1ч | AI contribution tracking |

**Общая оценка: ~40 часов работы, распределённых на 3 недели.**

---

## Критерии успеха

По завершении всех фаз проект должен соответствовать:

- [ ] Все изменения идут через feature branches + PR
- [ ] Pre-commit hooks ловят ошибки до коммита
- [ ] Claude Code hooks дают мгновенную обратную связь при редактировании
- [ ] CLAUDE.md покрывает все apps и ключевые packages
- [ ] Security constraints формализованы и проверяются в CI
- [ ] Тестовое покрытие: >60% packages, >40% apps
- [ ] E2E тесты покрывают critical user flows
- [ ] Custom skills ускоряют типовые задачи
- [ ] MCP серверы дают агенту доступ к внешнему контексту
- [ ] Conventional Commits + commitlint
- [ ] Scheduled agents для рутинных проверок
- [ ] Процесс Plan → Execute → Review → Merge формализован
