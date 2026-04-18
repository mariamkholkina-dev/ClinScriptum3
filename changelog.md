# Changelog

## 2026-04-18

### Добавлено

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
