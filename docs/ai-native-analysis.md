# Анализ: ClinScriptum vs. лучшие практики AI-Native разработки

Дата: 2026-04-29

Источник практик: курс "AI Coding для разрабов" (ai.khakhalev.com/course/) + собственные рекомендации.

## Текущее состояние проекта

| Метрика | Значение |
|---------|----------|
| Всего коммитов | 68 |
| AI-assisted (Co-Authored-By: Claude) | 32 (~47%) |
| Авторов | 1 (Холькин Павел) |
| Период разработки | 2026-03-28 → 2026-04-19 (22 дня) |
| Тесты | 12 файлов (6 packages + 6 apps/api) |
| Git hooks | Нет (нет husky/lint-staged) |
| Ветки/PR | Нет — прямые пуши в master |
| CLAUDE.md | Есть, 143 строки, хорошо структурирован |
| Claude Code hooks/skills | Не настроены |
| MCP серверы | Не подключены |

---

## Модуль 1: Первые шаги — Постановка задач и промптинг

**Что в курсе:** правильная формулировка задач, исследование проекта, эффективный промптинг.

**Текущее состояние: хорошо.**
Из git-истории и changelog видно, что задачи формулируются детально — коммит-сообщения конкретные, changelog содержит подробные описания что и зачем изменено. Проект хорошо структурирован, что облегчает AI исследование кодовой базы.

**Рекомендации:**
- Нет серьёзных проблем. Стиль уже системный, не "вайбкодинг".

---

## Модуль 2: Контекст, Feedback Loop, Галлюцинации

**Что в курсе:** управление контекстом для агента, итеративное улучшение, предотвращение ошибок AI.

**Текущее состояние: частично.**

Сильные стороны:
- CLAUDE.md подробно описывает архитектуру, команды, data flow
- Memory настроена (feedback о changelog)

Слабые стороны:
- **Нет per-package CLAUDE.md** — у каждого пакета/app своя специфика, но агент получает только общий контекст
- **Нет structured feedback loop** — нет механизма чтобы агент проверял свою работу перед коммитом (typecheck, lint, test)

**Рекомендации:**

1. **Добавить CLAUDE.md в ключевые подпроекты** — `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `packages/rules-engine/CLAUDE.md` с локальными инструкциями (паттерны роутеров, как добавить новый сервис, структура тестов)

2. **Настроить Claude Code hooks как feedback loop** — автоматический typecheck/lint после каждого редактирования:
```json
// .claude/settings.json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "command": "npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | head -20"
      }
    ]
  }
}
```

3. **Добавить в CLAUDE.md секцию "Verification checklist"** — перед каждым коммитом агент должен проверять: `npm run typecheck`, `npm run lint`, `npm test`

---

## Модуль 3: Безопасность и отладка

**Что в курсе:** поиск багов через AI, автоматизированное исправление, защита от уязвимостей.

**Текущее состояние: слабо.**

- Нет security-oriented тестов
- Нет SAST/DAST в CI
- Нет dependency audit в CI (`npm audit`)
- JWT_SECRET в CI захардкожен (`ci-test-secret`)
- Нет rate limiting тестов (хотя rate-limiter.ts существует)

**Рекомендации:**

4. **Добавить `npm audit` в CI pipeline:**
```yaml
- run: npm audit --audit-level=high
```

5. **Добавить `/security-review` в процесс** — перед каждым релизом или крупной фичей запускать встроенный security review Claude Code

6. **Написать тесты для auth и rate-limiter** — критическая инфраструктура безопасности покрыта минимально. Добавить edge cases: expired JWT, wrong tenant, rate limit exceeded

7. **Добавить секцию Security в CLAUDE.md:**
```markdown
### Security constraints
- Never log JWT tokens, API keys, or patient data
- All new endpoints must go through `verifyAccessToken` middleware
- Tenant isolation: every DB query must filter by `tenantId`
- Input validation via Zod on all tRPC inputs
```

---

## Модуль 4: AI-Native репозиторий

**Что в курсе:** подготовка репо для AI, заставить агента следовать инструкциям, документация для агентов.

**Текущее состояние: базовое.**

CLAUDE.md есть и хорош, но проект не полностью "AI-native".

**Рекомендации:**

8. **Настроить `.claude/settings.json` на уровне проекта** (не только `settings.local.json`):
```json
{
  "permissions": {
    "allow": [
      "Bash(npm run typecheck)",
      "Bash(npm run lint)",
      "Bash(npm test)",
      "Bash(npx prisma generate *)",
      "Bash(npx turbo *)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)"
    ]
  }
}
```
Сейчас всё в `settings.local.json` и разрешения накопились хаотично (97 записей, включая `taskkill`, `rm -rf`, `psql` — потенциально опасные). Нужно: минимальные safe-read permissions в project settings, личные расширения в local.

9. **Добавить structured error patterns в CLAUDE.md** — частые ошибки и как их решать:
```markdown
### Common gotchas
- After editing Prisma schema: run `npm run db:generate` before typecheck
- After adding new tRPC router: register it in `apps/api/src/routers/index.ts`
- ESM imports require `.js` extension in apps/api
```

10. **Создать шаблоны для типовых задач** — в CLAUDE.md или отдельных файлах описать "как добавить новый сервис", "как добавить новый роутер", "как добавить миграцию" с concrete file paths и patterns

---

## Модуль 5: Plan & Act — Методология автономного кодинга

**Что в курсе:** планирование, исследование, прототипирование, декомпозиция задач.

**Текущее состояние: отсутствует как формализованный процесс.**

Из истории коммитов видно: крупные фичи реализуются одним большим коммитом (например `da9fb30 Add Quality Improvement System, Rule Admin app, and parsing validation UI` — это огромный scope). Нет разбиения на PR, нет plan-then-execute workflow.

**Рекомендации:**

11. **Использовать Plan Mode для крупных задач** — перед реализацией фичей, которые затрагивают >3 файлов, входить в Plan Mode (`/plan`), согласовывать подход, и только потом переходить к реализации

12. **Ввести feature branches + PR workflow:**
```
master (protected) <- feature/FEAT-123-audit-mode <- коммиты
```
Это даст:
- Возможность code review (даже solo-разработчику через Claude `/review`)
- Атомарность фич
- Возможность откатить фичу целиком
- Историю обсуждений в PR

13. **Декомпозиция больших задач** — вместо одного коммита на всю фичу, разбивать на логические шаги: schema migration -> service layer -> API router -> UI. Каждый шаг — отдельный коммит с проверкой.

---

## Модуль 6: Автоматизация через Workflows

**Что в курсе:** skills, subagents, MCPs, внешний контекст, повторяемые workflows.

**Текущее состояние: не используется.**

Не настроены: Claude Code skills, hooks, MCP серверы, subagents. Весь процесс ручной.

**Рекомендации:**

14. **Настроить Claude Code hooks:**
```json
{
  "hooks": {
    "PreCommit": [
      {
        "command": "npx turbo typecheck lint"
      }
    ]
  }
}
```

15. **Создать custom skills для повторяющихся задач:**
- Skill "add-service" — создание нового сервиса по шаблону (service class + router + tests)
- Skill "add-migration" — создание и применение Prisma миграции
- Skill "audit-check" — запуск полного цикла проверки (typecheck + lint + test + security review)

16. **Подключить MCP серверы для внешнего контекста:**
- GitHub MCP — для работы с issues/PRs из Claude Code
- PostgreSQL MCP — для проверки структуры БД при работе с Prisma
- Если используется Linear/Jira для задач — соответствующий MCP

17. **Настроить `/schedule` для рутинных задач:**
- Еженедельный dependency update check
- Периодический security review
- Cleanup TODO/FIXME в коде

---

## Модуль 7: Обслуживание AI-Native репозитория

**Что в курсе:** борьба с энтропией, рефакторинг, code review, security review, смена парадигмы.

**Текущее состояние: проблемы с энтропией уже видны.**

Признаки:
- Changelog за 2 дня (27-29 апреля) содержит ~100 строк детальных изменений — высокий темп без видимого review
- Много незакоммиченных изменений (git status показывает ~45 modified файлов) — крупный diff, сложный для review
- Нет git hooks (husky) для pre-commit проверок
- Нет автоматического code review
- settings.local.json содержит 97 разрешений, многие одноразовые — накопленный хлам

**Рекомендации:**

18. **Ввести регулярный `/review` и `/security-review`** — после каждого значимого блока работы, до коммита

19. **Ввести `/simplify` после реализации фичи** — проверка на дублирование, качество кода

20. **Установить husky + lint-staged для pre-commit:**
```bash
npm install -D husky lint-staged
npx husky init
```
```json
// package.json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"]
}
```

21. **Периодический рефакторинг CLAUDE.md** — файл должен отражать текущую архитектуру. Устаревшие секции удалять, новые паттерны добавлять.

22. **Чистить settings.local.json** — удалить одноразовые permissions, оставить только повторяющиеся

---

## Сверх курса: дополнительные рекомендации

23. **E2E тесты (Playwright)** — для критических user flows (загрузка документа, запуск аудита, просмотр findings). В permissions уже есть `npx playwright *`, но тестов нет.

24. **Observability для AI-генерированного кода** — трекинг какие части кода написаны AI (уже есть Co-Authored-By), плюс мониторинг качества этих частей (bug rate, test coverage)

25. **Стратегия тестирования** — текущие 12 тест-файлов покрывают только packages и часть API. Нет тестов для:
- workers handlers (parse, classify, extract, audit, generate)
- processing pipeline orchestrator
- document service
- comparison/generation services
- Frontend компонентов

Минимум нужно: integration тесты для каждого worker handler и каждого сервиса.

26. **Structured commit messages** — перейти на Conventional Commits (`feat:`, `fix:`, `refactor:`) для автогенерации changelog и semantic versioning

27. **Branch protection rules** — даже для solo-разработчика: require CI pass before merge, no direct push to master

---

## Приоритетный план внедрения

| Приоритет | Действие | Усилие | Влияние |
|-----------|----------|--------|---------|
| P0 | Feature branches + PR workflow | Низкое | Высокое |
| P0 | Claude Code hooks (typecheck/lint pre-commit) | Низкое | Высокое |
| P0 | Закоммитить текущие 45 файлов мелкими атомарными коммитами | Среднее | Высокое |
| P1 | Per-package CLAUDE.md | Среднее | Высокое |
| P1 | Project-level .claude/settings.json с чистыми permissions | Низкое | Среднее |
| P1 | Husky + lint-staged | Низкое | Среднее |
| P1 | Plan Mode для крупных задач | Нулевое | Высокое |
| P1 | npm audit в CI | Низкое | Среднее |
| P2 | Custom skills для повторяющихся задач | Среднее | Среднее |
| P2 | MCP серверы (GitHub, DB) | Низкое | Среднее |
| P2 | Расширение тестового покрытия | Высокое | Высокое |
| P2 | Conventional Commits | Низкое | Низкое |
| P3 | E2E тесты (Playwright) | Высокое | Высокое |
| P3 | Scheduled agents для рутин | Низкое | Низкое |

---

## Резюме

Проект уже на хорошем базовом уровне AI-assisted разработки: есть CLAUDE.md, структурированный changelog, ~47% коммитов с Claude. Но по курсу Хахалева ключевые пробелы — это **отсутствие feedback loops** (hooks, pre-commit проверки), **отсутствие workflow-дисциплины** (нет веток, нет PR, нет review), и **неиспользование автоматизации Claude Code** (skills, hooks, MCP, scheduled agents). Самый высокий ROI даст внедрение feature branches с `/review` и настройка hooks — это превратит процесс из "AI пишет код -> человек пушит" в "AI пишет код -> AI проверяет -> человек ревьюит -> merge".
