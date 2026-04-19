# Changelog

## 2026-04-19

### Добавлено

- **Справочник фактов на вкладке Извлечение** — кнопка «Справочник» в тулбаре открывает модальное окно со всеми предопределёнными фактами из реестра, сгруппированными по категориям. Поддержка поиска по ключу, описанию и меткам. Показывается тип значения, приоритет и русские метки каждого факта
- **Фиксация результатов извлечения по уровням** — в модель `Fact` добавлены 6 полей: `deterministicValue`/`deterministicConfidence` (Level 1 — алгоритм), `llmValue`/`llmConfidence` (Level 2 — LLM), `qaValue`/`qaConfidence` (Level 3 — LLM QA). Все три обработчика (worker deterministic, API LLM extraction, API QA check) обновлены для записи результатов на своём уровне. В ExtractionViewer в раскрытой строке факта отображаются результаты каждого уровня с цветовой кодировкой
- **Реализованы Level 2 (LLM Check) и Level 3 (LLM QA) для извлечения фактов** — заглушка в worker pipeline заменена полноценными обработчиками. Level 2: LLM проверяет все извлечённые детерминистически факты, подтверждает/корректирует значения и находит пропущенные. Level 3: QA-аудитор проверяет факты с низкой уверенностью (<60%) и расхождением между алгоритмом и LLM, выбирает правильное значение. Результаты каждого уровня сохраняются в отдельных полях модели Fact
- **Результаты уровней извлечения в UI** — в строке факта на вкладке Извлечение отображаются компактные бейджи Д/L/Q с усечённым значением и confidence. Добавлен фильтр «Уровни» (совпадают / расходятся / QA исправил). В панели статистики показано количество фактов с результатами каждого уровня и число расхождений Д/L
- **Объединены два пути извлечения фактов в один** — удалена дублирующая LLM-first реализация (`fact-extraction.ts`), in-process pipeline (`processing-pipeline.ts`) и скрипт `resume-pipeline.ts` переведены на единый 3-уровневый конвейер (`fact-extraction-pipeline.ts`): deterministic → LLM Check → LLM QA. Добавлена зависимость `@clinscriptum/rules-engine` в API

### Исправлено

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
