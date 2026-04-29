# Changelog

## 2026-04-30

### Безопасность: валидация пары protocol/checked в inter-audit

- **`audit.service.ts`**: добавлен helper `validateInterAuditPair(tenantId, protocolVersionId, checkedVersionId)` — проверяет, что обе версии существуют, принадлежат тенанту, что `protocolVersionId` указывает на документ типа `protocol`, и что обе версии относятся к одному `study`. Возвращает оба объекта с включённым `document.study`.
- **`getInterAuditStatus(tenantId, protocolVersionId, checkedVersionId)`**, **`getInterAuditSummary(tenantId, protocolVersionId, checkedVersionId)`**, **`getInterAuditFindings(...)`** теперь все используют `validateInterAuditPair`. Раньше первые два игнорировали `protocolVersionId` (хотя router его принимал), и не проверяли его tenant — потенциальная утечка факта существования чужого протокола + возможность подмены пары.
- **Routers** `audit.getInterAuditStatus` и `audit.getInterAuditSummary` теперь прокидывают `input.protocolVersionId`.
- **Тесты `audit.service.test.ts`**: новый describe `inter-audit pair validation` — 6 кейсов (happy path, чужой tenant у protocol, чужой tenant у checked, не-protocol document, разные studies, та же валидация в Summary).

### Безопасность: tenant isolation в getTaxonomy

- **`document.service.getTaxonomy(tenantId)` и `tuning.service.getTaxonomy(tenantId)`**: добавлен обязательный параметр `tenantId`, фильтр `WHERE type=… AND (tenantId=$1 OR tenantId IS NULL)` с предпочтением tenant-specific RuleSet через `ORDER BY tenantId DESC NULLS LAST`. Раньше `findFirst` без фильтра возвращал любой подходящий RuleSet — потенциальная утечка чужой taxonomy между тенантами.
- **Routers `document.getTaxonomy` и `tuning.getTaxonomy`**: теперь прокидывают `ctx.user.tenantId`
- **Тесты `document.service.test.ts`**: 4 новых кейса — tenant-specific приоритет, fallback на global (tenantId=null), пустой результат, regression-проверка что чужой tenantId никогда не попадает в WHERE
- **Pre-existing lint-fix `processing-pipeline.ts:322`**: `order: order++` → `order: order` (no-useless-assignment, не использовался incremented value)

## 2026-04-30

### AI-Native практики: инфраструктура разработки

- **CLAUDE.md расширен**: добавлены секции Security constraints, Common gotchas, Git Workflow (Conventional Commits), Before committing checklist, Development Process (Plan & Act), Task decomposition template
- **Per-package CLAUDE.md**: созданы `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `apps/workers/CLAUDE.md`, `packages/rules-engine/CLAUDE.md` с локальными инструкциями для AI-агента
- **Claude Code hooks**: добавлен `.claude/settings.json` с PostToolUse hook (typecheck после каждого Edit/Write), project-level permissions, MCP серверы (GitHub, PostgreSQL)
- **Custom skills**: созданы 4 skill-файла — `verify` (проверка typecheck/lint/test), `add-service` (scaffold сервиса), `add-migration` (Prisma миграция), `pre-pr` (полный чеклист перед PR)
- **Husky + lint-staged + commitlint**: pre-commit hook с ESLint, commit-msg hook с Conventional Commits валидацией
- **CI усилен**: добавлен `npm audit`, отдельный security job с проверкой хардкоженных секретов, поддержка `master` ветки наряду с `main`
- **settings.local.json почищен**: 97 → 21 разрешение, удалены одноразовые и опасные записи

### Тесты

- **4 новых service-layer теста**: `study.service.test.ts`, `document.service.test.ts`, `audit.service.test.ts`, `processing.service.test.ts` — покрытие CRUD, tenant isolation, бизнес-правил
- **Orchestrator тест**: `apps/workers/src/pipeline/__tests__/orchestrator.test.ts` — 7 тестов: порядок выполнения, остановка pipeline, skip completed steps, retry failed steps, error handling
- **4 новых handler теста**: `parse-document.test.ts` (парсинг, ошибки, статусы), `classify-sections.test.ts` (RulesEngine, LLM skip, cache invalidation), `extract-facts.test.ts` (делегация к shared, pipeline wiring), `intra-doc-audit.test.ts` (editorial checks: double spaces, placeholders, mixed tense, status restore)
- **E2E тесты (web)**: добавлены `auth.spec.ts` (логин/логаут/redirect), `studies.spec.ts` (навигация по исследованиям), `document-upload.spec.ts` (загрузка документов), `audit.spec.ts` (аудит flow) к Playwright
- **E2E тесты (rule-admin)**: настроен Playwright для rule-admin (порт 3002), добавлены 5 спецов: `auth.spec.ts` (вход/выход, проверка ролей, redirect), `navigation.spec.ts` (сайдбар, навигация 12+ пунктов, collapse), `dashboard.spec.ts` (stat-карточки, quick actions, таблица запусков), `rules.spec.ts` (группы правил, создание, expand/collapse), `golden-dataset.spec.ts` (фильтры, создание образца, импорт)
- **Visual regression**: добавлены `visual.spec.ts` для `apps/web` (3 снимка: login, dashboard, studies) и `apps/rule-admin` (6 снимков: login, dashboard, rules, golden-dataset, sidebar collapsed, llm-config). Настроен `toHaveScreenshot()` с `maxDiffPixelRatio: 0.01`, фиксированный viewport 1280×720, mask для timestamp-элементов. Скрипт `e2e:update-snapshots` для обновления эталонов

### Починка зелёного baseline (pre-existing на master)

- **`apps/word-addin` TS-ошибки (4 шт.)**: `CounterBadge color="warning"` → `"important"` в `FindingsPanel.tsx` и `InterAuditPanel.tsx` (Fluent UI v9 переименовал палитру); удалён несуществующий импорт `Spinner24Regular` в `SectionList.tsx`; `tokens.colorPaletteBlueBorder1` → `tokens.colorBrandStroke1` в `ProtocolContext.tsx`
- **`packages/rules-engine` fact-extractor**: убрана проверка `value.length < 2` в `extract()`, которая ошибочно отбрасывала однобуквенные значения вроде `"2"` для `Phase 2 study` или `"I"` для `Phase I` (тест `extracts study_phase numeric format` теперь зелёный)
- **`packages/llm-gateway` lint-ошибки**: добавлен `cause: fetchErr` к `Error` после catch (правило `preserve-caught-error`); удалён лишний escape `\/` внутри character class в regex детекта Yandex модели

### CI

- **Test coverage**: добавлен `--coverage --reporter=text` к `turbo test` в CI
- **E2E job**: отдельный Playwright job с Chromium после основной сборки — запускает тесты и для `apps/web`, и для `apps/rule-admin`
- **test:coverage script**: добавлен в корневой `package.json`

### Observability

- **AI contribution report**: скрипт `scripts/ai-contribution-report.sh` — статистика AI-assisted коммитов, файлы с наибольшим AI-вкладом

## 2026-04-29

### Исправлено отображение findings с JSON в description + привязка к секциям

- **JSON-description парсинг** (оба UI): если `description` содержит сырой JSON (LLM вернул объект целиком), поля `description`, `issue_type`, `mode`, `severity`, `confidence`, `target_quote`, `reference_quote`, `editorial_fix_suggestion`, `block`, `field` извлекаются и отображаются как отдельные элементы карточки
- **Привязка к секциям** (`apps/web`): `relevantSections` теперь ищет по `sourceRef.zone` и `sourceRef.anchorZone` в дополнение к top-level `anchorZone`/`targetZone`
- **Парсер LLM-ответов** (`parseLLMFindings`): добавлен fallback для NDJSON (отдельные JSON-объекты без обёртки `[]`); `item.description` объект-значение корректно извлекается

### UI findings обновлён под единую структуру extraAttributes/sourceRef

- **Основной интерфейс** (`apps/web/src/app/(app)/audit/[docVersionId]/page.tsx`):
  - `extractFindingMeta()` приоритезирует `extraAttributes` над top-level полями; добавлены `issueFamily`, `auditCategory`, `anchorQuote`, `targetQuote`
  - Карточка `FindingCard`: бейдж метода (Детерм./LLM), семейство проблемы (`issueFamily`), вместо `issueType` в первом ряду теперь метод + taskKind + issueFamily + QA
  - Детальная панель `FindingDetail`: блок «Тип/Семейство/Категория», бейдж метода, цитаты `anchorQuote`/`targetQuote` из `sourceRef`
  - Фильтр по категории работает через `extraAttributes.auditCategory`
- **Эталонные наборы** (`apps/rule-admin/src/app/(app)/golden-dataset/[id]/page.tsx`):
  - `FindingCard`: бейджи метода, семейства (`issueFamily`), категории аудита; цитаты `anchorQuote`/`targetQuote` в раскрываемом блоке
  - `FindingsViewer`: извлечение severity приоритезирует `extraAttributes`
  - `generateExpectedJson`: генерация эталона включает `method`, `taskKind`, `issueFamily`, `auditCategory` из `extraAttributes`
- Добавлены словари: `METHOD_LABELS`, `ISSUE_FAMILY_LABELS` (оба приложения)

### Унификация структуры findings: fact-based аудит приведён к LLM-формату

- **`saveFindings()`** (`apps/api/src/lib/intra-audit.ts`): severity, issueType, issueFamily, auditCategory, method, confidence теперь сохраняются в `extraAttributes` (ранее — в top-level полях). `sourceRef` дополнен полями `zone`, `anchorZone`, `taskKind` по аналогии с LLM-обработчиком. `method: "deterministic"` для отличия от LLM-находок.
- **LLM cross-check находки** теперь `type: "semantic"` вместо `"intra_audit"` — совпадает с LLM handler
- **deleteMany** при повторном аудите удаляет находки всех трёх типов (`intra_audit`, `editorial`, `semantic`)

### Промты внутридокументного аудита вынесены в rule set

- **Все 5 захардкоженных промтов** теперь загружаются из системы rule set с фолбэком на встроенные дефолты:
  - `system_prompt` (Variant 1 — комплексный аудит)
  - `self_check_prompt` (Variant 2 — self-check)
  - `cross_check_prompt` (Variant 2 — cross-check)
  - `editorial_prompt` (Variant 2 — редакторская проверка)
  - `system_prompt` для QA (из отдельного rule set `intra_audit_qa`)
- **`toAuditPromptMap()`** — новая функция в `rules-engine/rule-adapter.ts`, возвращает `Map<string, string>` всех pattern→promptTemplate из набора правил
- **Seed-данные** (`seed-prompts.ts`): добавлены 4 правила в `intra_audit` rule set и 1 правило в новый `intra_audit_qa` rule set (promptTemplate пустые — используются встроенные дефолты)
- **Обработчик** (`intra-doc-audit.ts`): LLM Check загружает 4 промта через `toAuditPromptMap`, QA загружает свой промт из `intra_audit_qa`. Функция `runQaBatch` принимает промт как параметр
- **Prisma schema**: enum `RuleSubStage` расширен значениями `self_check`, `cross_check`, `editorial`

### UI-карточки находок аудита для медписателей

- **Карточка в списке** (`FindingCard`): severity-бейдж + issueType + вид проверки (self/cross/editorial) + QA-вердикт + статус; описание (3 строки); превью рекомендации; зоны (якорная → проверяемая) с русскими названиями; превью цитаты
- **Детальная панель** (`FindingDetail`): полный набор полей — описание, рекомендация, предлагаемая редакторская правка, зоны с бейджами, все цитаты (textSnippet, referenceQuote, anchorQuote, targetQuote) с цветовой маркировкой, QA верификация (вердикт + причина), предупреждение о недостаточном контексте, метаданные (метод, блок, поле)
- **Хелперы**: `extractFindingMeta()` извлекает данные из `extraAttributes` и `sourceRef`; словари русских названий зон (`ZONE_LABELS`), типов проверки (`TASK_KIND_LABELS`), уровней уверенности (`CONFIDENCE_LABELS`), QA-вердиктов (`QA_VERDICT_LABELS`)

### Ревью находок привязано к настройке operatorReviewEnabled

- **Бэкенд** (`audit.service.ts`): `getAuditStatus` теперь возвращает `operatorReviewEnabled` из настроек исследования. `getAuditFindings` блокирует показ находок за ревью только если `operatorReviewEnabled === true` для исследования. Ранее блокировало всегда для не-ревьюеров.
- **Фронтенд** (`audit/[docVersionId]/page.tsx`): баннер «Результаты на проверке» отображается только при включённом операторском ревью
- **Фикс фильтра находок**: `getAuditFindings` WHERE-условие исправлено — теперь включает типы `intra_audit`, `editorial`, `semantic` (ранее пропускал `semantic` и требовал `issueFamily: "EDITORIAL"`)

## 2026-04-28

### Исправлен автозапуск внутридокументного аудита

- **Баг**: кнопка «Внутридокументный аудит» (Shield) на странице исследования всегда перезапускала аудит, даже если он уже был проведён. Причина: `getAuditStatus` считал находки только с `type: "intra_audit"`, но обработчик создаёт находки с типами `editorial` и `semantic` — счётчик всегда возвращал 0, и `useEffect` запускал аудит снова
- **Фикс бэкенда** (`apps/api/src/services/audit.service.ts`): `totalFindings` теперь считает находки с типами `intra_audit`, `editorial`, `semantic`
- **Фикс фронтенда** (`apps/web/src/app/(app)/audit/[docVersionId]/page.tsx`): автозапуск не срабатывает если `runStatus === "completed"` или `"failed"` — аудит запускается только если ранее не было ни одного запуска

### Карточки находок в Эталонных наборах

- **Компонент `FindingCard`** — новый компонент карточки находки с цветной левой полосой по severity, бейджами (severity, issueType, taskKind, type, QA вердикт), статусом, описанием, рекомендацией, зонами
- **Раскрываемые секции** — клик по карточке показывает: цитаты из документа (target_quote, reference_quote, sectionTitle), редакторскую правку, QA верификацию (вердикт + причина), метаданные (метод, уверенность, контекст)
- **Фильтры** — `FindingsViewer` получил фильтры по severity и статусу с подсчётом
- **Данные из extraAttributes/sourceRef** — карточки извлекают severity, issueType, confidence, qaVerdict, qaReason, editorialFix из `extraAttributes`, а textSnippet, referenceQuote, zone, anchorZone из `sourceRef`
- **Ожидаемые результаты** — новый `ExpectedResultsViewer` рендерит ожидаемые находки аудита как карточки вместо raw JSON

### Читаемое отображение результатов аудита

- **Улучшен `StepResultSummary`** в `apps/rule-admin/src/app/(app)/audit/page.tsx` — результаты шагов аудита теперь отображаются структурированно вместо сырого JSON
- **Режим и вариант аудита** — выводятся цветные бейджи: режим (авто/один вызов/по зонам) и вариант (1 — весь документ / 2 — по зонам)
- **QA вердикты** — отдельная карточка с визуальными индикаторами: подтверждено (зелёный), отклонено (красный), скорректировано (жёлтый) с процентами
- **Новые метрики** — добавлены `deterministicFindings`, `dismissed`, `adjusted`, `confirmed` в таблицу меток
- **Остаточные данные** — отображаются в виде таблицы ключ-значение в сворачиваемом блоке «Подробности» вместо raw JSON

### Настраиваемый режим аудита и cross-check пары

- **Режим аудита (auditMode)** — новая настройка на уровне исследования: `auto` (по умолчанию — определяется по размеру документа), `single_call` (Variant 1 — весь документ одним вызовом LLM), `zone_based` (Variant 2 — зонный аудит с параллельными вызовами). Хранится в `Study.auditMode`
- **Настраиваемые cross-check пары** — для Variant 2 можно задать пары секций вручную через `Study.crossCheckPairs` (JSON-массив `[["zone1", "zone2"], ...]`) или оставить `null` для автоматического определения
- **Алгоритм автоопределения пар** — реализован на основе карты аффинности зон (`ZONE_AFFINITY_MAP`, 23 пары), построенной по модели clinnexus `CONSISTENCY_MAP`. Автоопределение фильтрует полную карту до пар, обе зоны которых присутствуют в документе. Покрывает: synopsis↔все ключевые разделы, objectives↔endpoints/statistics, endpoints↔statistics/SoA, design↔SoA/population, safety↔treatments/SoA/population/ethics, population↔statistics, treatments↔SoA
- **API** — эндпоинты `study.getSettings` и `study.updateSettings` расширены полями `auditMode` и `crossCheckPairs`. Валидация: `auditMode` — enum `auto|single_call|zone_based`, `crossCheckPairs` — массив пар строк или null
- **UI в rule-admin** — страница «Настройки обработки» расширена: радиокнопки выбора режима аудита (Авто/Variant 1/Variant 2), таблица cross-check пар с индикатором «Авто»/«Ручной», добавление/удаление пар через dropdown-селекторы зон, сброс к автоопределению
- **Перезапуск intra-audit через workers** — `audit.startIntraAudit` теперь отправляет задачу в очередь BullMQ вместо прямого вызова API-версии. Это обеспечивает: использование новых промтов с каталогами issue_type, настроек auditMode/crossCheckPairs, создание ProcessingSteps для отслеживания в UI, корректный pipeline с deterministic→llm_check→llm_qa. После завершения статус документа возвращается в `parsed`

## 2026-04-27

### Диагностика и устойчивость LLM-вызовов в intra-doc audit

- **Ошибки LLM теперь видны в аудите** — catch-блок `llm_check` шага в `intra-doc-audit.ts` сохранял `"LLM unavailable, skipped"` без деталей ошибки. Теперь в поле `llmError` записывается полное сообщение об ошибке, уровень логирования повышен с `warn` до `error`
- **Отображение LLM ошибок в UI аудита** — `StepResultSummary` в rule-admin теперь показывает `llmError` жёлтой плашкой. Добавлены метки: `llmFindings`, `tokensUsed`, `verified`, `deduplicated`
- **Fallback при неподдерживаемом `response_format`** — `generateYandexOpenAI` и `generateOpenAICompat` в LLM gateway теперь повторяют запрос без `response_format: json_object` при получении 400/422. DeepSeek v3 через Yandex OpenAI-compat endpoint может не поддерживать этот параметр, а системные промпты уже содержат инструкцию возвращать JSON
- **Увеличены таймауты для аудита** — `intra_audit`: 120с (было 50с), `intra_audit_qa`: 90с, `inter_audit`: 120с, `generation`: 120с. Задачи-специфичные дефолты через `DEFAULT_TIMEOUT_BY_TASK` в `llm-config-resolver.ts`
- **Исправлен reasoning для Yandex AI Studio** — `generateYandexOpenAI` отправлял `chat_template_kwargs: { enable_thinking: false }` (параметр vLLM, не Yandex). Заменён на `reasoning_effort: "medium"` — корректный параметр OpenAI-compatible API Yandex AI Studio. При `reasoningMode === "ENABLED_HIDDEN"` теперь передаётся `reasoning_effort`, при JSON-режиме — нет (reasoning и JSON несовместимы). Также исправлен парсинг ответа: `||` вместо `??` для fallback `reasoning_content` (пустая строка в `content` теперь не блокирует fallback)

### Переработка промтов intra-doc audit

- **3 специализированных промта** на основе проверенной системы из clinnexus — заменены примитивные промты (5-10 строк) на детальные инструкции:
  - **SELF-CHECK** — внутренние несоответствия зоны: числа, дозы, тайминги, плейсхолдеры, кросс-ссылки. Обязательная проверка таймингов процедур. Запрет editorial issue_type
  - **CROSS-CHECK** — сверка Reference vs Target: правило «отсутствие ≠ противоречие», запрет требования дублирования, спец-правила для цепочки отчётности и safety timelines
  - **EDITORIAL** — грамматика/стиль: лимит 8 issues, запрет nitpick, осторожность с сокращениями (считаем что есть глоссарий), перечень разрешённых editorial_* issue_type
- **QA промт усилен** — добавлены анти-FP правила: путаница артефактов, цепочки отчётности, сценариев, терминологии. Калибровка severity
- **Расширен `AuditFinding`** — новые поля: `issueType`, `block`, `field`, `referenceQuote`, `confidence`, `contextStatus`, `editorialFix`. Хранятся в `extraAttributes`/`sourceRef` модели Finding
- **Обновлён `parseLLMFindings`** — парсит расширенный формат (mode, issue_type, block, target_quote, reference_quote, confidence, context_status). Маппинг severity: Critical→high, Major→medium, Minor→low, Info→info. Удаляет `<analysis>` блоки
- **Auto-dismiss insufficient_context** — findings с `context_status="insufficient_context"` автоматически получают `status: "false_positive"` при создании
- **Полные каталоги issue_type в промтах** — во все 4 промта (AUDIT, SELF_CHECK, CROSS_CHECK, EDITORIAL) включены полные перечни типов проверок из clinnexus config.py: SELF BLOCK 01-17 (17 блоков самопроверки) и CROSS BLOCK 01-12 (12 блоков кросс-проверки). Общий промт AUDIT содержит оба каталога целиком. Стандартизированные `issue_type` значения обеспечивают единообразную классификацию и фильтрацию находок

### Настраиваемые исключённые секции для извлечения фактов

- **Добавлен `ip.preclinical_data`** в список исключённых секций (`EXCLUDED_SECTION_PREFIXES`) — секции с этим префиксом теперь пропускаются на всех уровнях: детерминированный, LLM Check, LLM QA. Обновлено в обоих файлах: `fact-extraction-core.ts` и `fact-extraction.ts`
- **Настраиваемый список на уровне исследования и глобально** — добавлено поле `excludedSectionPrefixes` в модель `Study` и новая модель `TenantConfig` для глобальных настроек. Логика приоритета: настройки исследования → глобальные (tenant) → хардкод-дефолты. Оба пайплайна (API и workers) загружают префиксы из БД и передают через `FactExtractionContext`
- **UI в rule-admin** — страница «Настройки обработки» теперь включает: (1) глобальные настройки с редактируемым списком исключённых секций через чипсы с кнопкой удаления и полем добавления, (2) на уровне исследования — переопределение глобального списка с кнопкой «Сбросить к глобальным»

### Фильтры согласованности уровней и выбор вариантов (apps/web)

- **Н��вые фильтры** — добавлены 3 фильтра на вкладке ��Факты»: `Д=LLM=QA` (все уровни согласны), `LLM=QA` (LLM и QA согласны), `Д≠LLM` (детерминированный и LLM расходятся). Сравнение регистронезависимое
- **Подтверждение выбора варианта** — при клике на радиокнопку варианта значение не сохраняется сразу, а показывается панель «Выбрано: ...» с кнопками «Сохранить выбор» и «Отмена». Предотвращает случайное перезаписывание

### Многоуровневый просмотр вариантов фактов (apps/web)

- **Переключение на `listFactsGrouped`** — вкладка «Факты» документа теперь использует группированный API-эндпоинт вместо `listFacts`. Каждый факт показывается одной строкой с `finalValue` и `finalConfidence`
- **Три колонки вариантов** — при раскрытии строки факта показываются три колонки: Детерминированный, LLM, LLM QA. Каждый вариант содержит значение, confidence и раскрываемый исходный текст. Радио-кнопка позволяет выбрать любой вариант как финальное значение (сохраняется как `manualValue`)
- **Индикаторы уровней** — в свёрнутой строке факта под factKey показаны бейджи: `Д ×N` (серый), `LLM` (синий), `QA` (фиолетовый), `Ручной` (жёлтый). Позволяют быстро видеть, какие уровни нашли значения
- **Сворачивание длинных списков** — для детерминированного уровня показываются первые 3 варианта с кнопкой «показать ещё N…». LLM и QA обычно имеют 1 вариант
- **Ручной ввод** — кнопка «Ввести значение вручную» под колонками вариантов. Заменяет отдельную иконку ✏ в строке

### Группировка детерминистических фактов по factKey

- **`runDeterministic` теперь создаёт одну строку на factKey** — раньше каждый regex-матч создавал отдельную строку в БД (10 совпадений `imp_name` → 10 строк). Теперь совпадения группируются по `factKey`, выбирается лучшее значение, все остальные сохраняются как варианты (`variants`). Это устраняет дублирование строк в UI
- **`listFactsGrouped` агрегирует значения уровней со всех строк** — для каждого уровня (deterministic/llm/qa) выбирается значение с наивысшим confidence из всех строк группы, а не только из первой
- **Полный JSON в аудите шагов обработки** — под метриками-бейджами добавлен раскрывающийся блок «Полный JSON» с полным результатом шага

## 2026-04-26

### Исправление формата zone key и приоритет заголовков в LLM-классификации

- **Канонические полные пути в `buildZoneLookup`** — `buildZoneLookup` теперь использует `r.pattern` (полный путь, например `appendix.references`) как значение маппинга вместо `cfg.key` (короткий ключ `references`). Все алиасы (короткий ключ, lowercase, нормализованный) ведут к каноническому полному пути. Решает проблему: LLM возвращал `references` и это сохранялось как `references`, а алгоритм хранил `appendix.references` — зоны не совпадали
- **Приоритет заголовков в промпте LLM Check** — добавлен блок «ПРИОРИТЕТ ИСТОЧНИКОВ ИНФОРМАЦИИ»: (1) заголовок + путь родительских заголовков — главный источник, (2) структура документа, (3) содержание раздела — только если заголовок неоднозначен (confidence < 0.7). Содержание не должно перевешивать очевидный заголовок
- **Структурированное отображение результатов шагов в аудите** — вместо сырого JSON теперь цветные метрики-бейджи: `updated` (зелёный), `skippedInvalidZone` (красный), `skippedNoZone` (жёлтый), `parseErrors` (красный), `retries` (жёлтый), `totalTokens`/`total` (серый), `corrections` (синий). Остальные данные (rejectedKeys и др.) в раскрывающемся блоке «Подробности»
- **Исправлен паттерн `comparator_name`** — убрано слово «плацебо» из группы ключевых слов-префиксов (раньше любой текст после «плацебо » захватывался как значение факта, порождая 11 мусорных фактов). Теперь два паттерна: (1) label:value со строгим разделителем `[:—–-]` без пробела, (2) отдельный паттерн для захвата «плацебо»/«placebo» как значения с негативным lookahead `(?![а-яёА-ЯЁa-zA-Z-])` чтобы не матчить «плацебо-контролируемое». Скрипт `generate-fact-patterns.ts` теперь автоматически обновляет изменённые паттерны (сравнивает с текущими в БД), а также поддерживает `--force` для полного обновления

### Переработка алгоритма извлечения фактов и UI

- **Level 2 LLM Check: посекционные запросы в discovery-режиме** — полностью переписан `runLlmCheck` в `fact-extraction-core.ts`. LLM теперь всегда работает в discovery-режиме (получает полный реестр фактов). Вместо одного запроса с синопсисом как якорным контекстом — отдельный запрос на каждую секцию (или группу связанных секций). Родительские секции группируются с дочерними, если общий текст укладывается в бюджет (6000 символов). Конкурентность запросов: 3 (настраиваемо через `LLM_CONCURRENCY`). Ретрай до 2 раз при ошибках. Результаты агрегируются по `factKey`: выбирается значение с наивысшим confidence, сохраняются все варианты
- **Variants: хранение всех вариантов значений факта** — добавлено JSONB-поле `variants` в модель `Fact` (Prisma). Каждый уровень (deterministic, llm_check, llm_qa) записывает свой вариант: `{value, confidence, level, sourceText, sectionTitle}`. При обновлении существующего факта варианты накапливаются. Это позволяет видеть все найденные значения и их источники
- **API: группированный список фактов** — новый tRPC-эндпоинт `listFactsGrouped`: группирует факты по `factKey`, объединяет варианты и источники, добавляет записи реестра для ненайденных фактов (`isFromRegistry: true`). Каскад финального значения: `manualValue → qaValue → llmValue → deterministicValue`
- **UI ExtractionViewer: одна строка на factKey** — полностью переписан компонент. Каждая строка показывает: factKey, категорию, значения по уровням (Д/L/Q) как цветные бейджи, финальное значение, confidence, статус (dropdown). Раскрываемая панель вариантов (`VariantPanel`): список уникальных вариантов с radio-кнопкой для выбора финального значения, исходный текст с подсветкой найденного значения, поле ручного ввода. Статистика: всего фактов, извлечённых, валидированных, с противоречиями, ненайденных, с разногласиями уровней. Фильтры: статус, категория, противоречия, наличие значения, диапазон confidence, согласованность уровней (Д≠L, QA-коррекции)

## 2026-04-24

### Улучшение LLM-классификации секций (worker-пайплайн)

- **100% секций проходят через LLM** — убран фильтр `confidence < 0.8`, LLM Check теперь классифицирует все секции документа, а не только неклассифицированные. Детерминистический шаг всегда передаёт управление на LLM Check (`needsNextStep: true`)
- **Иерархический контекст (breadcrumb)** — для каждой секции строится цепочка родительских заголовков (`buildParentChains`) и передаётся LLM. Это критично для корректной классификации неоднозначных заголовков вроде «Общая информация»
- **Числовые индексы вместо UUID** — LLM получает короткие индексы `[1]`, `[2]` вместо полных UUID, что устраняет проблему искажения/обрезки идентификаторов моделью
- **Ретрай батчей при отказе и ошибке** — при ошибке парсинга, отказе модели (YandexGPT content moderation) или сетевой ошибке/таймауте батч повторяется до 2 раз с задержкой. Ошибки изолированы на уровне батча — сбой одного батча не убивает остальные
- **Убран клинический контент из запроса** — LLM получает только заголовки, иерархию и первые 80 символов (против 500). Это главная причина отказов YandexGPT: клинический контент (AE, SAE, drug names) триггерит content moderation. Для классификации секций заголовок + иерархия достаточны
- **Валидация zone keys** — LLM-ответы проверяются на допустимость zone key из каталога, недопустимые ключи отбрасываются с логированием
- **Улучшенный промпт** — добавлен контекст типа документа (протокол, ICF, IB, CSR), инструкция проверять algo-результат, компактный формат ответа
- **Algo-результат в контексте секции** — LLM видит предварительную алгоритмическую классификацию и может подтвердить или скорректировать её
- **QA: breadcrumb + валидация + числовые индексы** — шаг LLM QA также получил иерархический контекст, числовые индексы и валидацию zone keys. Ошибки QA-батчей изолированы
- **LLM QA записывает `llmSection`/`llmConfidence`** — при корректировке секции QA теперь сохраняет результат в поля `llmSection`/`llmConfidence`, аналогично API-пайплайну. Расширен интерфейс `CachedSection` полями `algoSection`, `algoConfidence`, `llmSection`, `llmConfidence`
- **Индивидуальные запросы к LLM на каждую секцию** — полностью переделан LLM Check: вместо батчей по 25 секций теперь отправляется отдельный запрос на каждый заголовок. Контекст запроса: заголовок секции, путь в иерархии (breadcrumb), все заголовки верхнего уровня (структура документа), содержание раздела до 2000 символов, каталог допустимых зон. Ответ — один JSON-объект `{"zone":"...","confidence":0.95}`. Это устраняет проблему, когда модель возвращала 2 из 199 секций в батчевом режиме
- **Нормализация zone key + отрезание родительского префикса** — `resolveZoneKey` при отсутствии прямого совпадения отрезает первый сегмент до точки (`ip.preclinical_data` → `preclinical_data`) и пробует снова. Это решает главную проблему: LLM видел в каталоге `preclinical_data (parent: ip)` и конструировал `ip.preclinical_data`, но реальный ключ — `preclinical_data`. Промпт также явно объясняет: поле `parent` — метаданные, не часть ключа. Результат: 198 из 199 секций классифицированы (было 2 → 137 → 198)
- **Гибкий парсинг полей LLM-ответа** — LLM Check и QA принимают альтернативные имена полей (`idx`/`id`/`index`, `zone`/`zone_key`, `correct_zone`/`zone`), числовые и строковые значения confidence/idx
- **QA: строгое указание выбирать зоны из каталога** — в системный промпт QA добавлено «строго из каталога выше»

### LLM-конфигурации для Yandex AI Studio

- **Полная перенастройка LLM-конфигураций в seed** — удалены все предыдущие конфигурации LLM, добавлены 42 конфигурации (по 2 варианта на каждую из 21 задачи) с моделями Yandex AI Studio. Первый вариант (★) помечен как default. Используемые модели: YandexGPT 5.1 Pro (классификация, извлечение фактов, аудит фактов), Alice AI LLM (генерация CSR/ICF, суммаризация, перевод), DeepSeek-V3.2 (QA-арбитраж, аудит документов, анализ влияния, сравнение), Qwen3-235B-A22B (альтернативный вариант для всех задач). Timeout установлен 10 секунд для всех конфигураций
- **Управление звёздочкой «по умолчанию» на странице LLM config** — звёздочка в таблице теперь кликабельна: клик по активной звёздочке снимает статус по умолчанию (с подтверждением), клик по неактивной — устанавливает, с предупреждением если для задачи уже есть конфигурация по умолчанию. Добавлен API-эндпоинт `unsetDefault`
- **Режим рассуждений (Reasoning Mode) в LLM-конфигурации** — добавлено поле `reasoningMode` (`DISABLED` / `ENABLED_HIDDEN`) в Prisma-схему, gateway, resolver, API и UI. Для нативного Yandex Foundation Models API передаётся как `reasoningOptions.mode` в `completionOptions`. QA-арбитражные задачи, аудит и анализ влияния используют `ENABLED_HIDDEN` (активное рассуждение), базовые задачи классификации/извлечения/генерации — `DISABLED`. Настройка доступна в форме создания/редактирования конфигурации на странице LLM config
- **Dual API gateway для Yandex** — шлюз автоматически выбирает API по формату модели: `gpt://` модели (yandexgpt, deepseek-v3.2, alice-ai-llm) → нативный Foundation Models API (`/foundationModels/v1/completion`), plain модели (qwen3-235b-a22b-fp8) → OpenAI-совместимый API (`/v1/chat/completions`). Обе ветки используют `Api-Key` авторизацию

## 2026-04-23

### Мониторинг обработки документа

- **Real-time мониторинг обработки документа через SSE** — добавлен Server-Sent Events эндпоинт `/api/processing-events/:docVersionId` для стриминга событий обработки в реальном времени. Workers и API-пайплайн публикуют события через Redis Pub/Sub (`processing:events` канал): смена статуса версии документа (`version_status_changed`), старт/завершение/ошибка processing run (`run_started/completed/failed`), прогресс шагов пайплайна (`step_started/completed/failed/skipped`). SSE-эндпоинт поддерживает авторизацию через Bearer-токен (заголовок или query-параметр `?token=`), фильтрацию по `tenantId` и `docVersionId`, heartbeat каждые 30 секунд
- **Прогресс-бар обработки на странице документа** — при обработке документа отображается визуальный индикатор прогресса с 5 этапами: Разбор → Секции → Факты → SOA → Готов. Текущий этап подсвечен пульсирующей анимацией, завершённые — зелёным. Данные обновляются автоматически через SSE (без ручного обновления страницы)
- **React-хук `useProcessingMonitor`** — клиентский хук для подписки на SSE-поток обработки. Автоматически инвалидирует tRPC-кэш при получении событий, поддерживает реконнект при обрывах, активируется только когда документ в процессе обработки

### Исправления

- **Исправлена классификация секций для кириллических документов** — `SectionClassifier` в `rules-engine` не адаптировал regex-паттерны для кириллицы: JavaScript'овые `\b` (word boundary) и `\w` (word char) работают только с ASCII, поэтому паттерны вида `\bсинопсис\b` или `(?i)\bцели\b` никогда не матчили русские заголовки → confidence = 0% для всех секций. Добавлена функция `adaptPatternForUnicode` (аналогичная уже существующей в `processing-pipeline.ts`) с кэшированием скомпилированных regex и graceful handling невалидных паттернов
- **LLM-классификация пропускалась при пустом apiKey в DB-конфиге** — `getEffectiveLlmConfig` возвращал `apiKey: ""` напрямую из DB-конфига, без fallback на переменные окружения (`LLM_API_KEY`). Хендлер `classify-sections` проверял `!llmConfig.apiKey` → `!""` → `true` → весь LLM-шаг пропускался. При этом `testConnection` работал, т.к. имел свой fallback на env. Исправлено: `getEffectiveLlmConfig` теперь для DB-конфигов с пустым `apiKey`/`baseUrl` автоматически подставляет значения из переменных окружения
- **Thinking-блоки ломали парсинг JSON-ответов LLM** — модели Qwen3-Thinking могут возвращать `<think>...</think>` блоки перед JSON, даже когда `enable_thinking: false`. Жадный regex `/\[[\s\S]*\]/` захватывал квадратные скобки внутри thinking-блока вместе с реальным JSON-массивом → `JSON.parse` падал, ошибка проглатывалась в `catch`. Исправлено: все LLM-ответы (classify-sections, extract-facts, intra-doc-audit) теперь очищаются от `<think>` блоков перед парсингом. Добавлена диагностика: логирование `contentPreview` при ошибках парсинга, подсчёт skipped-записей по причинам (no zone, no section match)
- **Connect Timeout при обращении к RunPod LLM** — дефолтный connect timeout Node.js (10с) не хватал для RunPod serverless endpoints, которые могут просыпаться до 30-40с. Fetch падал после 3 попыток с `Connect Timeout Error`. Исправлено: добавлен `timeoutMs` в `LLMConfig` (дефолт 50с), прокинут из DB-конфига (`llm_configs.timeout_ms`) через `getEffectiveLlmConfig` → `LLMGateway` → `fetch(signal: AbortSignal.timeout(...))`  во всех хендлерах. Backoff между retry увеличен с 2с/4с/6с до 5с/10с/15с
- **LLM возвращал JSON-объект вместо массива** — YandexGPT при большом объёме секций (132) возвращала единственный JSON-объект `{...}` вместо массива `[...]`. Парсер искал только `[...]` и отбрасывал ответ целиком. Исправлено: парсер classify-sections и classify-sections-qa теперь обрабатывает оба формата — если массив не найден, ищет JSON-объект и оборачивает в массив (или извлекает вложенный массив из полей `sections`/`results`/`corrections`)

- **Исправлен maxOutputTokens для LLM-классификации секций** — в DB-конфигурации `section_classify` было установлено `maxOutputTokens: 200000`, что при ~62K входных токенов превышало лимит контекста модели (262144). Уменьшено до 4096 (достаточно для JSON-массива результатов). Аналогично `section_classify_qa` уменьшено с 32000 до 4096
- **Добавлены дефолты maxTokens/maxInputTokens для section_classify** — задачи `section_classify` и `section_classify_qa` добавлены в `DEFAULT_MAX_TOKENS` и `DEFAULT_MAX_INPUT_TOKENS` в `llm-config-resolver.ts` как страховка при отсутствии DB-конфига
- **maxOutputTokens и maxInputTokens обязательны** — оба поля теперь required при создании LLM-конфигурации: Prisma-схема (`Int` вместо `Int?`), tRPC-валидация, сервисный слой, форма в UI (убрана метка «необязательно», добавлена звёздочка, кнопка заблокирована при нулевых значениях)
- **Обновлены токен-лимиты для всех моделей tenant 2** — OpenAI/RunPod: `maxInputTokens: 200000`, `maxOutputTokens` по задачам (classify: 4096, extraction/generation/translation: 16384, остальные: 8192). YandexGPT: `maxInputTokens: 32000`, `maxOutputTokens` 4096 (QA) / 8192 (generation_qa)
- **LLM gateway: прямой fetch для OpenAI-совместимых эндпоинтов** — провайдеры с custom `baseUrl` (RunPod vLLM и др.) теперь используют прямой `fetch` вместо Vercel AI SDK. Это позволяет передавать `chat_template_kwargs: { enable_thinking: false }` при JSON-режиме, что отключает thinking mode у Qwen3-Thinking и обеспечивает чистый JSON-ответ. Retry 3 попытки с backoff (2с/4с/6с) при сетевых ошибках (Connect Timeout и др.)

### Настройки

- **Переключатель режима рассуждений LLM (Thinking)** — новая настройка `llmThinkingEnabled` на уровне исследования (Study). При включении разрешает LLM использовать цепочку рассуждений (chain-of-thought) при генерации текстовых ответов. В JSON-режиме thinking автоматически отключается (JSON + thinking ломает формат ответа). Для нерассуждающих моделей (OpenAI, YandexGPT, Anthropic) настройка не влияет — `chat_template_kwargs` передаётся только через `generateOpenAICompat` (vLLM). Настройка доступна на странице «Настройки исследования» в rule-admin

## 2026-04-21

### Устойчивость пайплайна

- **Graceful degradation при недоступности LLM** — все LLM-шаги при сетевых ошибках/таймаутах LLM логируют предупреждение и продолжают пайплайн с результатами детерминистического шага

### Чанкинг и полный охват документа в LLM-шагах

- **classify-sections LLM Check + LLM QA** — если секции не умещаются в inputBudget, они разбиваются на батчи; каждый батч отправляется отдельным вызовом LLM. Все секции гарантированно проходят через классификацию/QA
- **fact-extraction LLM Check** — документ разбивается на чанки по секциям если полный текст превышает бюджет. Каждый чанк обрабатывается отдельно, результаты мержатся (дедупликация новых фактов по factKey)
- **intra-doc-audit LLM Check: два варианта**:
  - *Вариант 1*: полный документ + промт умещаются в бюджет → один вызов LLM
  - *Вариант 2*: не умещается → зоновый аудит: секции группируются по standardSection в зоны, генерируются задачи `self_check` (внутренняя логика зоны), `cross_check` (сравнение пар зон: synopsis↔design, endpoints↔statistics и т.д.), `self_editorial` (грамматика/стиль). Каждая задача — отдельный вызов LLM
- **intra-doc-audit LLM QA** — полноценная проверка каждой находки на ложное срабатывание. Адаптивный контекст: (A) полный документ + все находки если влезает, (B) полный документ + батч находок, (C) релевантные секции + батч находок. Каждая находка может быть confirmed/dismissed/adjusted (с изменением severity). Dismissed → status `false_positive`

### Настройки исследования

- **Страница настроек исследования в rule-admin** (`/study-settings`) — выбор исследования из списка и управление параметрами пайплайна
- **Настройка operatorReviewEnabled** — toggle включает/выключает шаг ревью оператором (уровень 4) в пайплайне обработки для конкретного исследования
- **Поле `operator_review_enabled` в таблице `studies`** — новая boolean-колонка (default: false), API-эндпоинты `study.getSettings` / `study.updateSettings`
- **Проброс operatorReviewEnabled в пайплайн** — `run-pipeline.ts` читает настройку из Study и передаёт в classify-sections, extract-facts, intra-doc-audit

### 5 улучшений пайплайна

- **Параллельные LLM-вызовы** — `runWithConcurrency(tasks, 3)` вместо последовательных вызовов. Применено в classify-sections (LLM Check + QA), intra-doc-audit (Variant 2 zone tasks)
- **Кэш секций в PipelineContext** — `loadSections(ctx)` кэширует секции с contentBlocks в `sectionsCache` Map, `invalidateSectionsCache(ctx)` сбрасывает после записи. Используется в classify-sections, intra-doc-audit (все 3 уровня)
- **Synopsis-якорь в чанкинге** — fact-extraction: Synopsis всегда в chunk 0, для chunks 1..N prepend сжатый Synopsis (800 символов) для контекста
- **Дедупликация находок перед QA** — intra-doc-audit LLM QA: перед отправкой в QA находки дедуплицируются по нормализованному description и overlap sourceText (>70%). Дубли → `false_positive` с qaVerdict `deduplicated`
- **Structured output (JSON mode)** — LLM Gateway поддерживает `responseFormat: "json"`, передаёт `response_format: { type: "json_object" }` в provider options. Применено во всех LLM-шагах classify-sections, fact-extraction, intra-doc-audit

### Безопасность

- **JWT secret — обязательная проверка в production** — приложение падает при старте если `JWT_SECRET` не задан в `NODE_ENV=production`, вместо тихого fallback на захардкоженное значение
- **Tenant isolation на evaluation endpoints** — `getRun`, `getRunResults`, `getRunMetrics`, `compareRuns`, `deleteRun` теперь проверяют `tenantId` вызывающего пользователя, предотвращая cross-tenant доступ к данным оценок
- **Tenant verification в word-open** — endpoint `/api/word-open/:sessionId` теперь проверяет что документ принадлежит тенанту сессии
- **bulkUpdateFactStatus — проверка всех ID** — вместо валидации только первого `factId` из массива, `updateMany` теперь фильтрует по `tenantId` через связь `docVersion → document → study`
- **rotateRefreshToken — устранение TOCTOU race** — операция обёрнута в `prisma.$transaction`, `deleteMany` с проверкой `count > 0` предотвращает двойную ротацию при параллельных запросах
- **Rate limiter — Redis sliding window** — rate limiting переведён с in-memory `Map` на Redis sorted set (sliding window). Ключи `rl:user:{userId}` / `rl:ip:{ip}` с автоматическим TTL. Атомарная multi-операция (zremrangebyscore + zadd + zcard + pexpire). Fail-open при недоступности Redis. Per-user keying через JWT payload

### Исправлено

- **Pipeline error propagation** — стадии 3-5 (fact extraction, SOA detection, intra-audit) больше не проглатывают ошибки молча; при ошибке любой стадии document version получает статус `error` вместо зависания в промежуточном статусе
- **console.error → logger в word-addin** — pipeline ошибки в word-addin upload теперь логируются через структурированный logger с correlationId
- **Graceful shutdown** — API и workers обрабатывают `SIGTERM`/`SIGINT` с корректным завершением (закрытие сервера, drain BullMQ worker, отключение Prisma). Добавлен `unhandledRejection` handler

### Производительность

- **Batch inserts в saveSections** — парсинг документа в workers обёрнут в `prisma.$transaction`, content blocks вставляются через `createMany` вместо поштучных INSERT
- **Batch updates в классификации секций** — все три этапа классификации (deterministic, LLM classify, LLM QA) собирают DB updates и выполняют их в одной `prisma.$transaction` вместо поштучных UPDATE. LLM-вызовы по-прежнему последовательные (rate limits), но запись результатов батчится
- **N+1 в getSoaData** — вместо отдельного запроса `contentBlock` на каждую таблицу, один `findMany` с `id: { in: [...] }` и join в JS
- **S3Client singleton** — S3Client создаётся один раз при первом использовании вместо нового экземпляра на каждый upload/download/delete
- **Bounded regexCache** — ограничение размера кеша регулярных выражений (max 500 entries) с FIFO-вытеснением
- **Типизация listAllRuns** — `where: any` заменён на `Record<string, unknown>`

### Рефакторинг

- **Дедупликация fact extraction** — core-логика (deterministic, LLM Check, LLM QA) извлечена в `@clinscriptum/shared/fact-extraction`. API in-process pipeline (`fact-extraction-pipeline.ts`: 478→72 строки) и worker handler (`extract-facts.ts`: 464→53 строки) теперь импортируют из единого модуля. Унифицирован источник реестра фактов: оба пути используют `loadRulesForType` (DB через bundle) вместо дублирования YAML-based vs DB-based подходов
- **Дедупликация SOA detection** — алгоритм детекции SOA (675 строк) извлечён в `@clinscriptum/shared/soa-detection` с параметризованным логгером. API (`soa-detection.ts`: 675→11 строк) теперь делегирует в shared-модуль
- **Миграция на BullMQ pipeline** — обработка документов (parse → classify → extract facts → SOA → intra-audit) переведена с fire-and-forget `runProcessingPipeline()` на BullMQ queue. API теперь добавляет job `run_pipeline` в очередь через `enqueueJob()`, worker обрабатывает полный конвейер с retry/DLQ/idempotency. Затронуты: `document.service.ts` (confirmUpload, reprocessVersion), `word-addin.ts` (uploadNewVersion). Добавлен `apps/api/src/lib/queue.ts` для подключения API к Redis queue, `apps/workers/src/handlers/run-pipeline.ts` для оркестрации полного pipeline

### Тестирование

- **Инфраструктура тестов для apps** — добавлены `vitest.config.ts` для `apps/api` и `apps/workers`, скрипт `test` в `package.json` обоих приложений. Workers config с `passWithNoTests` для корректной работы в CI
- **Unit-тесты auth** (`apps/api/src/lib/__tests__/auth.test.ts`, 10 тестов) — покрытие `hashPassword`/`verifyPassword`, `signAccessToken`/`verifyAccessToken` (валидный, невалидный, tampered токен), `rotateRefreshToken` (несуществующий токен, истёкший токен с очисткой, TOCTOU race при конкурентной ротации, успешная ротация с проверкой данных в транзакции)
- **Unit-тесты rate-limiter** (`apps/api/src/lib/__tests__/rate-limiter.test.ts`, 6 тестов) — покрытие лимита запросов, блокировки при превышении, сброс окна по таймеру, установка заголовков `X-RateLimit-*`, per-user keying через JWT, изоляция разных IP
- **Unit-тесты tenant isolation evaluation** (`apps/api/src/services/__tests__/evaluation.service.test.ts`, 15 тестов) — покрытие `getRun`, `getRunResults`, `getRunMetrics`, `compareRuns`, `deleteRun`, `listRuns` с проверкой cross-tenant блокировки (NOT_FOUND при чужом tenantId), передачи фильтров, удаления только своих данных

## 2026-04-20

### Добавлено

- **Страница «Аудит обработок» в Rule Admin** — страница `/audit` с полноценной навигацией: cursor-пагинация (Назад/Далее), настраиваемый размер страницы (20/50/100), сортировка по клику на заголовки колонок (документ, исследование, тип, статус, этапы, дата), текстовый поиск по документу/исследованию/типу/бандлу, фильтры по типу и статусу, колонка общей длительности обработки, русские метки статусов. На уровне обработки показывается использованный Rule Bundle, на уровне каждого этапа (раскрытие строки) — LLM-конфигурация и snapshot правил
- **Исправлен конфликт типов fact_extraction** — RuleSet «Fact Extraction LLM Prompts» перенесён с типа `fact_extraction` на `fact_extraction_qa`, чтобы `loadRulesForType("fact_extraction")` всегда возвращал реестр с 60 правилами, а не промпты с 2 записями
- **Лимиты промптов и ответов LLM из конфигурации** — все алгоритмы обработки теперь берут максимальный размер входного текста (`maxInputTokens`) и ответа (`maxOutputTokens`) из LLM-конфигурации в БД вместо хардкода. Добавлен параметр `maxInputTokens` в `LlmTaskConfig`, хелпер `getInputBudgetChars()` для конвертации токенов в символы. `llmAsk()` в API теперь загружает конфиг из БД через `getEffectiveLlmConfig()` с учётом тенанта. Обновлены: классификация секций (полный текст секции вместо 800 символов), извлечение фактов, intra/inter-аудит (бюджет по конфигу вместо 8000/10000 символов), генерация ICF/CSR, все worker-обработчики
- **Кнопка «Перезапустить разбор» в интерфейсе writer** — добавлена кнопка с иконкой RotateCcw в карточке версии документа. При нажатии (с подтверждением) удаляет всю историю обработки (processing steps/runs, findings, facts, SOA, content blocks, sections) и перезапускает pipeline с нуля
- **Поиск и фильтры на странице исследований** — текстовый поиск по номеру протокола, названию, спонсору, препарату и терапевтической области. Фильтры-dropdown по фазе, спонсору и терапевтической области (строятся динамически из данных). Счётчик результатов и кнопка сброса
- **Клонирование LLM-конфигурации на несколько задач** — кнопка «Клон» в строке конфигурации (Rule Admin, `/llm-config`) открывает модал с мультивыбором задач по группам. Сортировка таблицы по клику на заголовок колонки, фильтры по провайдеру и статусу, текстовый поиск

## 2026-04-19

### Добавлено

- **Справочник фактов на вкладке Извлечение** — кнопка «Справочник» в тулбаре открывает модальное окно со всеми предопределёнными фактами из реестра, сгруппированными по категориям. Поддержка поиска по ключу, описанию и меткам. Показывается тип значения, приоритет и русские метки каждого факта
- **Фиксация результатов извлечения по уровням** — в модель `Fact` добавлены 6 полей: `deterministicValue`/`deterministicConfidence` (Level 1 — алгоритм), `llmValue`/`llmConfidence` (Level 2 — LLM), `qaValue`/`qaConfidence` (Level 3 — LLM QA). Все три обработчика (worker deterministic, API LLM extraction, API QA check) обновлены для записи результатов на своём уровне. В ExtractionViewer в раскрытой строке факта отображаются результаты каждого уровня с цветовой кодировкой
- **Реализованы Level 2 (LLM Check) и Level 3 (LLM QA) для извлечения фактов** — заглушка в worker pipeline заменена полноценными обработчиками. Level 2: LLM проверяет все извлечённые детерминистически факты, подтверждает/корректирует значения и находит пропущенные. Level 3: QA-аудитор проверяет факты с низкой уверенностью (<60%) и расхождением между алгоритмом и LLM, выбирает правильное значение. Результаты каждого уровня сохраняются в отдельных полях модели Fact
- **Результаты уровней извлечения в UI** — в строке факта на вкладке Извлечение отображаются компактные бейджи Д/L/Q с усечённым значением и confidence. Добавлен фильтр «Уровни» (совпадают / расходятся / QA исправил). В панели статистики показано количество фактов с результатами каждого уровня и число расхождений Д/L
- **Объединены два пути извлечения фактов в один** — удалена дублирующая LLM-first реализация (`fact-extraction.ts`), in-process pipeline (`processing-pipeline.ts`) и скрипт `resume-pipeline.ts` переведены на единый 3-уровневый конвейер (`fact-extraction-pipeline.ts`): deterministic → LLM Check → LLM QA. Добавлена зависимость `@clinscriptum/rules-engine` в API

### Исправлено

- **LLM Check работает в режиме полного извлечения, если детерминистический шаг не нашёл фактов** — ранее Level 2 (LLM Check) возвращал ранний выход при пустом списке фактов, что приводило к пустой вкладке «Факты» после обработки. Теперь при отсутствии детерминистических результатов LLM Check переключается в «discovery mode»: загружает реестр фактов и просит LLM самостоятельно извлечь все факты из документа. Исправлено в обоих путях: API in-process pipeline (`fact-extraction-pipeline.ts`) и worker pipeline (`extract-facts.ts`)
- **Основной пайплайн обработки (`processing-pipeline.ts`) подключён к системе бандлов** — при загрузке документа автоматически резолвится активный бандл для тенанта; все `ProcessingRun`, создаваемые in-process пайплайном, теперь записывают `ruleSetBundleId`; таксономия загружается через `loadRulesForType(bundleId, type)` вместо прямого запроса к активной версии
- **Автоматическое определение активного бандла при запуске обработки** — `processingService.startRun()` теперь резолвит активный бандл через `resolveActiveBundle(tenantId)`, если `bundleId` не передан явно. Это гарантирует, что все шаги пайплайна используют одну и ту же версию правил
- **Оптимизация `loadRulesForType`** — устранён лишний запрос к БД: `findFirst` теперь фильтрует по типу RuleSet в запросе, а не проверяет тип в JS после получения произвольной записи

### Добавлено

- **Seed реестра фактов** (`seed-fact-registry.ts`) — 60 определений фактов из 9 категорий (protocol_meta, study, study_design, population, treatment, intervention, endpoints, statistics, bioequivalence) загружаются из `fact-registry.yaml` в RuleSet типа `fact_extraction`. Скрипт `seed:facts`, добавлен в `seed:all`
- **Промпты генерации перенесены в общий rule set** — страница `/generation-prompts` теперь редиректит на `/rules?group=Генерация`; отдельный пункт sidebar убран; страница `/rules` поддерживает query-параметр `group` для автовыбора группы и первого RuleSet
- **Per-section generation prompts** — каждый раздел ICF (12 секций) и CSR (15 секций) теперь имеет индивидуальный промпт в БД, редактируемый через Rule Admin. Хелпер `loadGenerationPrompts()` в `packages/db` загружает активные промпты из RuleSet; воркеры `generate-icf` и `generate-csr` используют цепочку fallback: промпт секции → системный промпт из БД → захардкоженная константа. Seed `seed-prompts.ts` расширен на 27 новых правил (12 ICF + 15 CSR)
- **RuleSet Bundle** — новая сущность `RuleSetBundle` группирует версии нескольких RuleSet (классификация, экстракция, аудит, генерация) в единую конфигурацию пайплайна. Каждый `ProcessingRun` привязан к бандлу через `ruleSetBundleId`. Каждый `ProcessingStep` хранит `ruleSnapshot` (JSONB) — снапшот применённых правил для аудита и воспроизводимости. Хендлеры (`classify-sections`, `extract-facts`, `generate-icf`, `generate-csr`, `intra-doc-audit`) загружают правила из бандла с fallback на активные версии и хардкоженные дефолты. API: `bundle.*` tRPC роутер (list, get, create, addEntry, removeEntry, activate, clone, delete). Type bridge: `rule-adapter.ts` в `packages/rules-engine` конвертирует DB Rule → `SectionMappingRule`/`FactExtractionRule`/prompt. Seed создаёт Default Bundle с 15 активными версиями
- **Rule Admin: страница бандлов** (`/bundles`) — создание, клонирование, удаление бандлов; просмотр entries (тип, имя RuleSet, версия, кол-во правил); добавление/удаление версий RuleSet из бандла; активация/деактивация; пункт «Бандлы конфигурации» в sidebar

### Изменено

- **Разделение подтверждения структуры и классификации секций** — поле `Section.status` разделено на `structureStatus` (подтверждение парсинга: заголовки, границы, уровни) и `classificationStatus` (подтверждение классификации: привязка к стандартным секциям). Два независимых статуса, два бейджа в UI, две кнопки массового подтверждения.
  - **Миграция БД**: `status` → `classification_status`, новая колонка `structure_status`; `review_comment` → `classification_comment`, новая колонка `structure_comment`
  - **API**: `validateAllSections` → `validateAllStructure` + `validateAllClassification`; `updateSectionStatus` / `bulkUpdateSectionStatus` → раздельные эндпоинты для структуры и классификации
  - **Frontend web**: страница документа — два бейджа (зелёный для структуры, синий для классификации), две кнопки массового подтверждения
  - **Frontend rule-admin**: ParsingTreeViewer — два бейджа, фильтры по обоим статусам, bulk-операция привязана к структуре
- **Исправлен LLM Gateway**: провайдер `"openai"` теперь передаёт `baseURL` в `createOpenAI()`, что позволяет использовать OpenAI-совместимые эндпоинты (RunPod, vLLM, Ollama и т.д.) через настройку Base URL

## 2026-04-18

### Добавлено

- **Деплой Rule Admin** — `Dockerfile.rule-admin` (standalone Next.js на порту 3002), Helm deployment + service + ingress на `admin.clinscriptum.com`, ресурсы и реплики в `values.yaml`
- **Обновление Docker-образов на Node 24** — все Dockerfile (`api`, `web`, `workers`, `rule-admin`) переведены с `node:20-alpine` на `node:24-alpine` для совместимости с npm 11 и актуальным `package-lock.json`; все Dockerfile теперь копируют полный набор workspace `package.json` и используют `npm ci` без `--workspace` фильтра

- **Расширенный просмотрщик валидации парсинга** (`rule-admin`, golden-dataset detail page):
  - Иерархическое дерево секций с автоматической нумерацией (1, 1.1, 1.2, ...)
  - Раскрытие контента секции (параграфы, таблицы, сноски, списки) по клику
  - Сортировка: по порядку, заголовку, уровню, статусу, количеству блоков
  - Фильтры: по статусу, уровню вложенности, наличию контента, только аномалии
  - Массовые операции: выделение чекбоксами + «Подтвердить» / «На доработку»
  - Автодетекция аномалий: пустые секции, осиротевшая вложенность, дубли заголовков, короткие секции
  - Diff с эталоном: сравнение структуры с ожидаемыми результатами (пропущенные / лишние / неверный уровень)
  - Параллельный просмотр исходника с авто-скроллом к выбранной секции
  - Клавиатурная навигация (стрелки, Enter, пробел)
- **Бэкенд endpoint `processing.bulkUpdateSectionStatus`** — массовое обновление статуса секций (до 200 за раз)
- **Загрузка результатов обработки в golden-dataset** — вкладки Парсинг, Классификация, Извлечение, SOA, Аудит теперь показывают реальные данные из `document.getVersion`, `processing.listFacts`, `processing.getSoaData`, `processing.listFindings`

- **Комментарий при отправке на проверку** — при нажатии «На проверку» открывается модальное окно для ввода комментария; комментарий сохраняется в БД (поле `review_comment` в `GoldenSampleStageStatus`) и отображается на панели этапа
- **Каскадное выделение подзаголовков** — при выборе родительского заголовка автоматически выделяются все дочерние секции
- **Автоскролл исходника** — клик по заголовку в дереве парсинга автоматически прокручивает панель исходника к соответствующей секции

- **Подключение workers к DB-конфигурациям LLM** — воркеры теперь используют `getEffectiveLlmConfig()` из `@clinscriptum/db` вместо хардкода env-переменных. Цепочка приоритетов: tenant DB → global DB → task env → global env
- **Снимок LLM-конфигурации в ProcessingStep** — новое поле `llm_config_snapshot` (JSONB) фиксирует provider, model, temperature, maxTokens и источник конфигурации для каждого шага пайплайна
- **Панель «Настройки LLM»** в golden-dataset detail — раскрываемая секция показывает какие LLM-настройки использовались для каждого шага обработки (provider, модель, temperature, max tokens, источник конфига)
- **Общая функция `getEffectiveLlmConfig`** вынесена в `@clinscriptum/db` — единая реализация для API и workers с поддержкой `tenantId`
- **`tenantId` в PipelineContext** — оркестратор загружает `tenantId` из Study для передачи в handlers

### Исправлено

- **useEffect не импортирован** в `golden-dataset/page.tsx` — ReferenceError при открытии страницы
- **Бесконечный цикл рендера** в `AddDocumentModal` на `golden-dataset/[id]/page.tsx` — добавлен debounce + hasFetched
- **Повреждённые Unicode-символы** в ParsingTreeViewer.tsx

## 2026-04-17

### Добавлено

- **Quality Improvement System — полная реализация.** Система непрерывного улучшения качества обработки клинических документов на всех этапах пайплайна (парсинг → классификация → извлечение фактов → SOA → аудит → генерация).

#### Схема данных (Prisma)
- Добавлена роль `rule_approver` в `UserRole`
- Расширен `RuleSetType` на 19 новых значений (все этапы пайплайна + QA)
- Расширена модель `Rule`: `documentType`, `stage`, `subStage` (analysis/qa), `promptTemplate`, `isEnabled`, `requiresFacts`, `requiresSoa`, `order`
- 9 новых моделей: `LlmConfig` (с `ContextStrategy`), `GoldenSample`, `GoldenSampleDocument`, `GoldenSampleStageStatus`, `EvaluationRun`, `EvaluationResult`, `CorrectionRecord`, `CorrectionRecommendation`, `ApprovalRequest`

#### API (apps/api)
- 7 новых сервисов: `rule-management`, `llm-config`, `golden-dataset`, `evaluation`, `correction`, `disagreement`, `approval`
- 5 новых tRPC-роутеров: `ruleManagement`, `llmConfig`, `goldenDataset`, `evaluation`, `quality`
- `qualityProcedure` middleware для ограничения доступа ролями rule_admin/rule_approver/tenant_admin
- 21 LLM-задача с независимой конфигурацией (provider, model, temperature, maxTokens)

#### Workers (apps/workers)
- 3 новых обработчика: `run-evaluation`, `run-batch-evaluation`, `analyze-corrections`
- Конфигурация retry для новых задач

#### Rule Admin (apps/rule-admin) — новое приложение (порт 3002)
- Next.js 14 + React 18 + Tailwind CSS + tRPC
- 12 экранов: Dashboard, Rules & Prompts, Generation Prompts, LLM Config, Golden Dataset (список + детали), Evaluation (список + детали), LLM Comparison, Batch Testing, SOA Detection, Corrections, Disagreements, Approvals
- Zustand для auth state, JWT авторизация
- Sidebar с навигацией и ролевой видимостью

#### Seed данные
- `seed-prompts.ts`: 13 RuleSet с промптами для всех этапов (intra/inter audit, ICF/CSR generation, SOA detection, fact extraction, classification, impact analysis, change classification, correction recommendation, generation QA)
- Пользователи `ruleadmin@demo.clinscriptum.com` и `ruleapprover@demo.clinscriptum.com` в основном seed
- Скрипты `seed:prompts`, `seed:taxonomy`, `seed:all` в packages/db

#### Конфигурация
- `.env.example` расширен на все 21 LLM-задачу с отдельными настройками для analysis и QA
- CORS обновлён для localhost:3002
- YandexGPT добавлен как LLM-провайдер в llm-gateway

## 2026-04-16

### Изменено

- **Название документа при загрузке берётся из имени файла.** В форме загрузки новой версии (`apps/web/src/app/(app)/studies/[id]/page.tsx`, функция `VersionUploadForm`) при создании нового `Document` поле `title` теперь заполняется именем загружаемого файла без расширения `.docx` вместо метки типа документа (`DOC_TYPES.label`).
