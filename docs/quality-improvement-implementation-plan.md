# План реализации: Quality Improvement System

## Текущее состояние (что уже есть)

### Уже реализовано
- **TuningSession** + 4 типа вердиктов (SectionVerdict, FactVerdict, SoaVerdict, GenerationVerdict)
- **RuleSet/RuleSetVersion/Rule** — базовая модель, используется для section classification
- **Tuning UI** в apps/web: создание сессий, review вердиктов, golden set marking, regression
- **tuning.service.ts** (785 строк): CRUD сессий, вердикты, stats, regression, golden set toggle
- **Regression testing**: сравнение golden set вердиктов с текущими результатами алгоритмов
- **LLM Gateway**: multi-provider (OpenAI, Anthropic, Azure, Qwen/YandexGPT)

### Что нужно переработать
- LLM промпты захардкожены inline в 5 файлах (~2500 строк суммарно):
  - `processing-pipeline.ts` (classification, extraction prompts)
  - `intra-audit.ts` (703 строки, cross-check + editorial prompts)
  - `inter-audit.ts` (693 строки, CSR/ICF concordance prompts)
  - `doc-generation.ts` (461 строка, generation + QA prompts)
  - `soa-detection.ts` (676 строк, scoring patterns)
- Taxonomy частично в `taxonomy.yaml`, частично в hardcoded `DEFAULT_PROTOCOL_SECTIONS`
- Нет per-task LLM configuration в БД
- Нет мульти-документных golden samples
- Нет implicit feedback (CorrectionRecord)
- Нет workflow согласования
- Нет отдельного приложения rule-admin
- Нет batch evaluation
- Нет context window testing

---

## Фазы реализации

---

## Фаза 0. Подготовка (1 неделя)

### 0.1. Аудит промптов и правил
- [ ] Инвентаризация всех промптов: выписать каждый system/user prompt из 5 файлов с указанием stage/sub-stage
- [ ] Инвентаризация детерминистических правил: все regex-паттерны, scoring weights, thresholds
- [ ] Маппинг: промпт/правило -> LLM task ID из списка 21 task
- [ ] Документирование формата input/output каждого промпта

### 0.2. Проектирование схемы данных
- [ ] Спроектировать новые Prisma модели (детали в Фазе 1)
- [ ] Спроектировать миграцию существующих TuningSession/Verdict данных (если есть)
- [ ] Ревью схемы

**Выход**: документ с полной инвентаризацией промптов/правил + финальная схема данных

---

## Фаза 1. Схема данных (1 неделя)

### 1.1. Расширение модели RuleSet/Rule

```
Текущее:
  RuleSetType: section_classification, fact_extraction, soa_identification, audit

Новое:
  RuleSetType: добавить
    - section_classification_qa
    - fact_extraction_qa
    - soa_detection
    - soa_detection_qa
    - intra_audit_qa
    - inter_audit
    - inter_audit_qa
    - fact_audit_intra
    - fact_audit_intra_qa
    - fact_audit_inter
    - fact_audit_inter_qa
    - generation (per section prompts)
    - generation_qa
    - impact_analysis
    - impact_analysis_qa
    - change_classification
    - change_classification_qa
    - correction_recommend

  Rule: добавить поля
    - documentType: Protocol | ICF | IB | CSR | null (global)
    - stage: string (LLM task ID)
    - subStage: "analysis" | "qa"
    - promptTemplate: String (LLM prompt text)
    - isEnabled: Boolean (для опциональных правил, напр. fact/SOA-based audit)
    - requiresFacts: Boolean
    - requiresSoa: Boolean
    - order: Int (порядок применения)
```

- [ ] Prisma migration: расширение RuleSet, RuleSetVersion, Rule
- [ ] Обновить enum RuleSetType
- [ ] Добавить поля в Rule

### 1.2. Новая модель: LlmConfig

```
LlmConfig {
  id: String (uuid)
  tenantId: String? (nullable, global configs)
  name: String (display name, e.g. "Qwen 235B RunPod")
  taskId: String (один из 21 LLM task IDs)
  provider: String
  baseUrl: String
  apiKey: String (encrypted)
  model: String
  temperature: Float
  maxOutputTokens: Int
  maxInputTokens: Int
  contextStrategy: Enum (chunk, multi_chunk, full_document, multi_document)
  chunkSizeChars: Int?
  chunkOverlapChars: Int?
  modelWindowChars: Int?
  rateLimit: Int? (requests per minute)
  timeoutMs: Int?
  coldStartMs: Int? (RunPod)
  costPerInputKTokens: Float?
  costPerOutputKTokens: Float?
  isActive: Boolean
  isDefault: Boolean (default config for this task)
  createdAt: DateTime
  updatedAt: DateTime
}
```

- [ ] Prisma migration: создать LlmConfig
- [ ] Seed: перенести текущие .env значения как default configs

### 1.3. Новая модель: GoldenSample

```
GoldenSample {
  id: String (uuid)
  tenantId: String
  name: String (display name)
  description: String?
  sampleType: Enum (single_document, multi_document)
  createdById: String (fk -> User)
  createdAt: DateTime
  updatedAt: DateTime

  documents: GoldenSampleDocument[] (1:many)
  stageStatuses: GoldenSampleStageStatus[] (1:many)
  evaluationResults: EvaluationResult[] (1:many)
}

GoldenSampleDocument {
  id: String (uuid)
  goldenSampleId: String (fk)
  documentVersionId: String (fk -> DocumentVersion)
  documentType: Enum (Protocol, ICF, IB, CSR)
  role: String (e.g. "primary", "reference", "target")
  order: Int
}

GoldenSampleStageStatus {
  id: String (uuid)
  goldenSampleId: String (fk)
  stage: String (parsing, classification, extraction, soa_detection, intra_audit, inter_audit, generation, impact_analysis)
  status: Enum (draft, in_review, approved)
  reviewedById: String? (fk -> User)
  approvedById: String? (fk -> User)
  reviewedAt: DateTime?
  approvedAt: DateTime?

  expectedResults: Json (эталонные результаты для этого stage)
}
```

- [ ] Prisma migration: создать GoldenSample, GoldenSampleDocument, GoldenSampleStageStatus

### 1.4. Новая модель: EvaluationRun / EvaluationResult

```
EvaluationRun {
  id: String (uuid)
  tenantId: String
  name: String?
  type: Enum (single, batch, llm_comparison, context_window_test)
  status: Enum (queued, running, completed, failed)
  ruleSetVersionId: String? (fk -> RuleSetVersion)
  llmConfigId: String? (fk -> LlmConfig)
  contextStrategy: String? (override for context window testing)
  chunkSizeChars: Int? (override)

  metrics: Json (aggregate: precision, recall, F1 per stage)
  cost: Float? (total LLM cost)
  durationMs: Int?
  totalSamples: Int
  passedSamples: Int
  failedSamples: Int

  comparedToRunId: String? (fk -> EvaluationRun, for A/B comparison)
  delta: Json? (diff vs compared run)

  createdById: String (fk -> User)
  createdAt: DateTime
  completedAt: DateTime?

  results: EvaluationResult[] (1:many)
}

EvaluationResult {
  id: String (uuid)
  evaluationRunId: String (fk)
  goldenSampleId: String (fk)
  stage: String
  status: Enum (pass, fail, error, skipped)

  expected: Json (from GoldenSampleStageStatus.expectedResults)
  actual: Json (result of current run)
  diff: Json (structured diff expected vs actual)

  algoResult: Json? (deterministic result)
  llmResult: Json? (LLM result)
  agreement: Boolean? (algo == llm)

  precision: Float?
  recall: Float?
  f1: Float?
  latencyMs: Int?
  tokenCost: Float?
}
```

- [ ] Prisma migration: создать EvaluationRun, EvaluationResult

### 1.5. Новая модель: CorrectionRecord

```
CorrectionRecord {
  id: String (uuid)
  tenantId: String
  userId: String (fk -> User)
  userRole: String (writer, qc_operator, findings_reviewer, rule_admin)
  documentVersionId: String (fk -> DocumentVersion)
  stage: String (classification, extraction, soa, audit, generation)
  entityType: String (section, fact, finding, soa_cell, generated_section)
  entityId: String (fk to specific entity)

  originalValue: Json
  correctedValue: Json
  context: Json (surrounding text, section title, etc.)

  isProcessed: Boolean (false — new, true — already analyzed)
  recommendationId: String? (fk -> CorrectionRecommendation)

  createdAt: DateTime
}

CorrectionRecommendation {
  id: String (uuid)
  tenantId: String
  stage: String
  pattern: String (description of the pattern)
  frequency: Int (how many corrections match this pattern)
  suggestedChange: String (what to change in rule/prompt)
  affectedRuleId: String? (fk -> Rule)
  status: Enum (pending, accepted, rejected, implemented)
  reviewedById: String? (fk -> User)
  reviewedAt: DateTime?
  comment: String?
  createdAt: DateTime

  corrections: CorrectionRecord[] (1:many)
}
```

- [ ] Prisma migration: создать CorrectionRecord, CorrectionRecommendation

### 1.6. Новая модель: ApprovalRequest

```
ApprovalRequest {
  id: String (uuid)
  tenantId: String
  type: Enum (rule_change, prompt_change, golden_sample_approval, verdict_approval)
  status: Enum (pending, approved, rejected)
  requestedById: String (fk -> User, rule_admin)
  reviewedById: String? (fk -> User, rule_approver)

  title: String
  description: String
  context: Json (what is being changed, before/after, evaluation results)

  entityType: String (rule, prompt, golden_sample_stage, etc.)
  entityId: String

  comment: String? (reviewer comment)
  requestedAt: DateTime
  reviewedAt: DateTime?
}
```

- [ ] Prisma migration: создать ApprovalRequest

### 1.7. Добавить роль rule_approver

- [ ] Обновить enum Role: добавить `rule_approver`
- [ ] Prisma migration

### 1.8. Миграция существующих данных

- [ ] Скрипт: перенос taxonomy.yaml -> RuleSet/Rule записи в БД
- [ ] Скрипт: перенос DEFAULT_PROTOCOL_SECTIONS -> Rule записи
- [ ] Скрипт: перенос DEFAULT_FACT_RULES -> Rule записи
- [ ] Скрипт: перенос hardcoded промптов -> Rule записи с promptTemplate
- [ ] Скрипт: перенос .env LLM_* -> LlmConfig записи

**Выход**: все новые таблицы созданы, существующие данные мигрированы

---

## Фаза 2. Перенос правил и промптов в БД (2 недели)

### 2.1. Сервис управления правилами и промптами

- [ ] `apps/api/src/services/rule-management.service.ts`:
  - CRUD для RuleSet, RuleSetVersion, Rule
  - Версионирование: создание новой версии, активация, деактивация
  - Откат к предыдущей версии
  - Экспорт/импорт правил (JSON)
  - Audit trail (кто, когда, что изменил)

### 2.2. Сервис LLM Configuration

- [ ] `apps/api/src/services/llm-config.service.ts`:
  - CRUD для LlmConfig
  - Test connection (отправить тестовый запрос)
  - Per-task default management
  - Fallback logic (task config -> default config -> .env)

### 2.3. Адаптация processing-pipeline.ts

Заменить hardcoded промпты на загрузку из БД:

- [ ] Classification: загрузка taxonomy из RuleSet вместо taxonomy.yaml
- [ ] Classification LLM: загрузка промпта из Rule.promptTemplate
- [ ] Fact extraction: загрузка правил из RuleSet вместо DEFAULT_FACT_RULES
- [ ] Fact extraction LLM: загрузка промпта из Rule.promptTemplate
- [ ] LLM config: загрузка из LlmConfig вместо config.ts -> .env

### 2.4. Адаптация intra-audit.ts

- [ ] Перенос CROSS_CHECK_STRATEGIES в RuleSet
- [ ] Перенос editorial check промптов в Rule
- [ ] Перенос QA промпта в Rule
- [ ] Перенос детерминистических правил (placeholder patterns, range checks) в Rule
- [ ] Загрузка LlmConfig из БД

### 2.5. Адаптация inter-audit.ts

- [ ] Перенос CHECK_GROUPS (CSR 8 + ICF 7 групп) в RuleSet
- [ ] Перенос промптов per check в Rule.promptTemplate
- [ ] Перенос QA промптов в Rule
- [ ] Загрузка LlmConfig из БД

### 2.6. Адаптация doc-generation.ts

- [ ] Перенос DEFAULT_ICF_TEMPLATE (12 секций) в RuleSet
- [ ] Перенос DEFAULT_CSR_TEMPLATE (12 секций) в RuleSet
- [ ] Перенос generation промпта per section в Rule.promptTemplate
- [ ] Перенос QA промпта per section в Rule.promptTemplate
- [ ] Загрузка LlmConfig из БД

### 2.7. Адаптация soa-detection.ts

- [ ] Перенос TITLE_PATTERNS в Rule
- [ ] Перенос HEADER_SIGNALS + weights в Rule
- [ ] Перенос PROCEDURE_PATTERNS в Rule
- [ ] Перенос MARKER_PATTERNS в Rule
- [ ] Перенос scoring thresholds в RuleSet config
- [ ] LLM промпт для SOA (если добавляется) в Rule.promptTemplate

### 2.8. Адаптация LLM Gateway

- [ ] `llmAsk()` принимает LlmConfig вместо task string
- [ ] Fallback: если LlmConfig не передан, загружает из БД по taskId
- [ ] Логирование usage/cost per request

### 2.9. Тесты

- [ ] Unit тесты: загрузка правил из БД работает идентично hardcoded
- [ ] Regression: прогон существующих тестов rules-engine, doc-parser

**Выход**: все правила и промпты управляются через БД, hardcoded значения удалены, pipeline работает как прежде

---

## Фаза 3. API: сервисы и роутеры системы качества (2 недели)

### 3.1. Golden Dataset сервис

- [ ] `apps/api/src/services/golden-dataset.service.ts`:
  - Создание golden sample (single + multi-document)
  - Загрузка документа + запуск пайплайна
  - Управление stage statuses (draft -> in_review -> approved)
  - Сохранение expected results per stage
  - Пакетный импорт документов с привязкой к исследованию
  - Фильтрация и поиск

### 3.2. Evaluation сервис

- [ ] `apps/api/src/services/evaluation.service.ts`:
  - Создание EvaluationRun (single, batch, llm_comparison, context_window_test)
  - Запуск evaluation (делегирование в worker)
  - Расчёт метрик per stage (precision, recall, F1)
  - A/B сравнение двух прогонов (delta)
  - Расчёт стоимости прогона
  - Получение результатов с фильтрами

### 3.3. Disagreement сервис

- [ ] `apps/api/src/services/disagreement.service.ts`:
  - Получение расхождений algo vs LLM per stage
  - Фильтрация (только расхождения, по confidence, по stage)
  - Сохранение вердикта ("algo прав" / "LLM прав" / "оба неправы")
  - Конвертация вердикта в golden sample expected result

### 3.4. Correction сервис

- [ ] `apps/api/src/services/correction.service.ts`:
  - Запись CorrectionRecord (вызывается из основного приложения)
  - Агрегация корректировок по паттернам
  - Генерация CorrectionRecommendation (детерминистически + через LLM)
  - CRUD рекомендаций (accept/reject/implement)

### 3.5. Approval сервис

- [ ] `apps/api/src/services/approval.service.ts`:
  - Создание ApprovalRequest
  - Список запросов для rule_approver
  - Утверждение/отклонение
  - Применение изменений при утверждении

### 3.6. tRPC роутеры

- [ ] `apps/api/src/routers/rule-management.ts` — CRUD правил и промптов
- [ ] `apps/api/src/routers/llm-config.ts` — CRUD LLM конфигураций
- [ ] `apps/api/src/routers/golden-dataset.ts` — CRUD golden samples
- [ ] `apps/api/src/routers/evaluation.ts` — запуск и результаты evaluation
- [ ] `apps/api/src/routers/disagreement.ts` — disagreements и вердикты
- [ ] `apps/api/src/routers/correction.ts` — корректировки и рекомендации
- [ ] `apps/api/src/routers/approval.ts` — workflow согласования
- [ ] Обновить `apps/api/src/routers/index.ts` — подключить новые роутеры
- [ ] Middleware: проверка роли rule_admin / rule_approver

### 3.7. Интеграция сбора корректировок в существующие роутеры

- [ ] `document.ts`: при переклассификации секции -> CorrectionRecord
- [ ] `audit.ts`: при правке finding -> CorrectionRecord
- [ ] `processing.ts`: при ручной корректировке факта -> CorrectionRecord
- [ ] `word-addin.ts`: при правке в Word -> CorrectionRecord

**Выход**: полный API для системы качества, интеграция сбора корректировок

---

## Фаза 4. Workers: evaluation jobs (1.5 недели)

### 4.1. Evaluation worker

- [ ] `apps/workers/src/handlers/run-evaluation.ts`:
  - Получает EvaluationRun ID
  - Загружает golden samples с approved stages
  - Для каждого sample + stage: прогоняет через текущий pipeline
  - Сравнивает actual vs expected
  - Записывает EvaluationResult
  - Рассчитывает метрики
  - Обновляет EvaluationRun (status, metrics, cost, duration)

### 4.2. Batch evaluation worker

- [ ] `apps/workers/src/handlers/run-batch-evaluation.ts`:
  - Прогон по всему пулу документов (не только golden set)
  - Косвенные метрики: confidence distribution, agreement rate
  - Сравнение с предыдущим batch run (дельта)
  - Параллельный прогон нескольких документов (concurrency control)

### 4.3. LLM comparison worker

- [ ] `apps/workers/src/handlers/run-llm-comparison.ts`:
  - Один golden set, несколько LlmConfig
  - Прогон через каждую конфигурацию
  - Сравнительная таблица метрик

### 4.4. Context window test worker

- [ ] `apps/workers/src/handlers/run-context-window-test.ts`:
  - Один golden set, одна LlmConfig, разные context strategies
  - Прогон с chunk / multi_chunk / full_document / multi_document
  - Метрики quality + cost + latency per strategy

### 4.5. Correction analysis worker

- [ ] `apps/workers/src/handlers/analyze-corrections.ts`:
  - Периодический анализ накопленных CorrectionRecord
  - Группировка по паттернам
  - Генерация CorrectionRecommendation (через LLM task `correction_recommend`)

### 4.6. Регистрация новых workers

- [ ] Обновить `apps/workers/src/index.ts` — зарегистрировать 5 новых handlers
- [ ] Обновить `apps/workers/src/pipeline/orchestrator.ts` — поддержка evaluation jobs
- [ ] Обновить `apps/workers/src/lib/retry-config.ts` — retry для evaluation jobs

**Выход**: фоновые задачи evaluation, comparison, analysis работают

---

## Фаза 5. Приложение rule-admin: каркас (1 неделя)

### 5.1. Создание приложения

- [ ] `apps/rule-admin/` — новое Next.js/Vite приложение
- [ ] `apps/rule-admin/package.json` — зависимости (React, tRPC client, Tailwind/UI kit)
- [ ] Обновить корневой `package.json` — добавить workspace
- [ ] Обновить `turbo.json` — добавить rule-admin в pipeline
- [ ] Port: 3002

### 5.2. Авторизация

- [ ] Login страница (JWT, только rule_admin + rule_approver)
- [ ] Auth context + guards
- [ ] tRPC client setup (подключение к apps/api на :4000)

### 5.3. Layout и навигация

- [ ] Sidebar с разделами: Dashboard, Golden Dataset, Evaluation, LLM Comparison, Disagreements, Corrections, Rules & Prompts, Generation Prompts, SOA, Approvals, Batch Testing, LLM Configuration
- [ ] Header: user info, logout
- [ ] Role-based visibility: rule_approver видит только Approvals

### 5.4. Общие компоненты

- [ ] DataTable (sortable, filterable, paginated)
- [ ] MetricsCard (precision/recall/F1 display)
- [ ] DiffViewer (side-by-side comparison)
- [ ] StatusBadge (draft/in_review/approved/pass/fail)
- [ ] ConfirmDialog
- [ ] JsonEditor (для правил)
- [ ] PromptEditor (для промптов с подсветкой переменных)

**Выход**: каркас приложения, авторизация, навигация, базовые компоненты

---

## Фаза 6. UI: LLM Configuration (0.5 недели)

### 6.1. Список конфигураций

- [ ] Таблица: name, task, provider, model, status, cost
- [ ] Фильтр по task/provider/status
- [ ] Кнопка "Добавить"

### 6.2. Форма создания/редактирования

- [ ] Все поля из LlmConfig модели
- [ ] Dropdown для task (21 вариант, группированные по stage)
- [ ] Кнопка "Проверить подключение"
- [ ] Валидация обязательных полей

### 6.3. Привязка к этапам

- [ ] Матрица: stage x sub-stage -> выбор LlmConfig
- [ ] Default config per task

**Выход**: rule admin может управлять LLM конфигурациями через UI

---

## Фаза 7. UI: Golden Dataset (1.5 недели)

### 7.1. Список golden samples

- [ ] Таблица: name, document type, stage statuses (иконки), created by, date
- [ ] Фильтр: по типу документа, по stage status, по дате
- [ ] Кнопка "Загрузить документ" / "Пакетный импорт"

### 7.2. Загрузка документа

- [ ] Upload форма: файл, тип документа, привязка к исследованию
- [ ] Для multi-document: добавление нескольких документов с ролями
- [ ] Запуск пайплайна после загрузки

### 7.3. Пакетный импорт

- [ ] Upload нескольких файлов
- [ ] Маппинг: файл -> исследование + тип документа + версия
- [ ] Bulk создание golden samples
- [ ] Progress bar

### 7.4. Golden Sample Detail

- [ ] Табы per stage: Parsing, Classification, Extraction, SOA, Audit, Generation
- [ ] Каждый таб: status badge, результаты algo vs LLM, корректировка
- [ ] Кнопки: "Утвердить", "Отправить на согласование"
- [ ] Для classification: таблица секций с algo_section vs llm_section, editable
- [ ] Для extraction: таблица фактов, editable values
- [ ] Для SOA: визуализация таблицы, editable
- [ ] Для audit: список findings, accept/reject
- [ ] Для generation: side-by-side сгенерированное vs эталонное

**Выход**: rule admin может управлять golden dataset через UI

---

## Фаза 8. UI: Evaluation и Dashboard (1.5 недели)

### 8.1. Dashboard

- [ ] Карточки метрик per stage (текущий F1, тренд)
- [ ] График: F1 по времени per stage
- [ ] Топ-5 проблемных мест (lowest accuracy)
- [ ] Последние evaluation runs (status, delta)
- [ ] Количество pending approvals
- [ ] Количество новых корректировок

### 8.2. Запуск evaluation

- [ ] Форма: выбор типа (single/batch/llm_comparison/context_window)
- [ ] Выбор RuleSetVersion
- [ ] Выбор LlmConfig (или нескольких для comparison)
- [ ] Выбор context strategy (для context window test)
- [ ] Выбор golden samples (или "все approved")
- [ ] Кнопка "Запустить"
- [ ] Progress: realtime статус через polling

### 8.3. Результаты evaluation

- [ ] Summary: общие метрики, стоимость, время
- [ ] Таблица per sample: stage, status (pass/fail), precision, recall, F1
- [ ] Drill-down: expected vs actual, diff view
- [ ] A/B сравнение: side-by-side двух прогонов, зелёное/красное

### 8.4. LLM Comparison view

- [ ] Таблица: model A vs model B vs model C per stage
- [ ] Bar chart: F1 per stage per model
- [ ] Cost comparison

### 8.5. Context Window test view

- [ ] Таблица: chunk 4K vs 16K vs full doc per stage
- [ ] Scatter plot: quality (F1) vs cost
- [ ] Рекомендация оптимальной стратегии

**Выход**: rule admin видит метрики, запускает evaluation, сравнивает результаты

---

## Фаза 9. UI: Rules & Prompts (1.5 недели)

### 9.1. Список RuleSet

- [ ] Группировка по stage
- [ ] Для каждого: active version, количество правил, дата последнего изменения
- [ ] Кнопка "Создать новую версию"

### 9.2. Редактор RuleSet Version

- [ ] Список правил в версии
- [ ] Для taxonomy правил: паттерны, gate_patterns, not_keywords — JSON editor
- [ ] Для промптов: PromptEditor с подсветкой переменных {{section_title}}, {{content}}
- [ ] Preview: тестовый прогон одного примера через правило/промпт
- [ ] Diff с предыдущей версией
- [ ] Кнопки: "Активировать", "Откатить", "Отправить на согласование"

### 9.3. Generation Prompts (отдельный экран)

- [ ] Список секций ICF + CSR
- [ ] Для каждой: generation prompt + QA prompt
- [ ] Inline editing
- [ ] Preview: сгенерировать одну секцию из тестового протокола

### 9.4. SOA правила

- [ ] Title patterns, header signals, procedure patterns, marker patterns
- [ ] Scoring weights, thresholds
- [ ] Preview: прогнать SOA detection на тестовом документе

### 9.5. Audit правила

- [ ] Intra-audit: cross-check strategies, editorial rules, fact-based rules
- [ ] Inter-audit: check groups per document type pair
- [ ] Toggle enabled/disabled per rule
- [ ] Toggle requires_facts, requires_soa

### 9.6. Version history

- [ ] Список всех версий RuleSet с датами и авторами
- [ ] Diff между любыми двумя версиями
- [ ] Откат к выбранной версии

**Выход**: rule admin может редактировать все правила и промпты через UI

---

## Фаза 10. UI: Disagreements и SOA (1 неделя)

### 10.1. Disagreements

- [ ] Таблица: document, stage, algo result, LLM result, confidence algo, confidence LLM
- [ ] Фильтр: по stage, по типу документа, "только расхождения"
- [ ] Inline verdict: radio (algo/llm/custom) + custom value + comment
- [ ] Bulk actions: "принять все algo" / "принять все LLM" для выборки
- [ ] Кнопка "Добавить в golden set"

### 10.2. SOA view

- [ ] Список документов с SOA
- [ ] Для каждого: визуализация SOA таблицы (procedures x visits)
- [ ] Highlighting: правильно/неправильно распознанные ячейки
- [ ] Inline correction: edit procedure names, visit names, cell values
- [ ] Метрики: detection rate, extraction accuracy

**Выход**: rule admin может разбирать расхождения и корректировать SOA

---

## Фаза 11. Implicit Feedback и Corrections (1 неделя)

### 11.1. Интеграция сбора корректировок

- [ ] Хуки в существующих компонентах web app:
  - Section reclassification -> CorrectionRecord
  - Fact value edit -> CorrectionRecord
  - Finding accept/reject -> CorrectionRecord
  - SOA cell correction -> CorrectionRecord
  - Generated text edit -> CorrectionRecord
- [ ] API endpoint: `correction.record` (вызывается из web app)

### 11.2. UI: Corrections dashboard

- [ ] Агрегированная таблица: паттерн, stage, частотность, примеры
- [ ] Drill-down: список конкретных корректировок
- [ ] Рекомендации системы: предложенные правки с обоснованием
- [ ] Кнопки: "Принять" (применить правку), "Отклонить", "Отправить на согласование"

### 11.3. Worker: анализ корректировок

- [ ] Регулярный запуск (по кнопке или по расписанию)
- [ ] Группировка однотипных корректировок
- [ ] Генерация рекомендаций через LLM (correction_recommend task)

**Выход**: корректировки пользователей собираются, агрегируются, генерируются рекомендации

---

## Фаза 12. Workflow согласования (1 неделя)

### 12.1. Создание запросов на согласование

- [ ] При правке правил/промптов: кнопка "Отправить на согласование"
- [ ] При утверждении golden sample stage: кнопка "Отправить на согласование"
- [ ] При принятии рекомендации: кнопка "Отправить на согласование"
- [ ] Формирование контекста: что меняется, before/after, результаты evaluation

### 12.2. UI: Approvals (для rule_approver)

- [ ] Список входящих запросов (pending)
- [ ] Detail view: контекст, diff, evaluation результаты
- [ ] Кнопки: "Утвердить" / "Отклонить" + комментарий
- [ ] История решений

### 12.3. Notifications

- [ ] В UI: badge с количеством pending approvals
- [ ] При утверждении/отклонении: уведомление rule admin

**Выход**: четырёхглазый контроль для изменений правил и промптов

---

## Фаза 13. Fact/SOA-based аудит (1 неделя)

### 13.1. Новые правила аудита

- [ ] Intra-doc fact-based: правила проверки согласованности фактов внутри документа
- [ ] Intra-doc SOA-based: проверка соответствия SOA и текста
- [ ] Inter-doc fact-based: сверка фактов между документами
- [ ] Все правила в RuleSet с флагами requires_facts, requires_soa, isEnabled

### 13.2. Адаптация audit pipeline

- [ ] Загрузка fact-based правил из БД
- [ ] Проверка: extraction и SOA detection завершены? Если нет — skip
- [ ] Прогон fact-based checks (детерминистика + LLM)
- [ ] Запись findings с type "fact_audit" / "soa_audit"

### 13.3. UI: toggle в настройках

- [ ] Переключатель "Fact/SOA-based audit" per rule
- [ ] Индикация зависимостей: "требует extraction" / "требует SOA"

**Выход**: новый режим аудита на основе извлечённых фактов и SOA

---

## Фаза 14. Batch Testing (1 неделя)

### 14.1. Пакетный импорт пула документов

- [ ] UI: массовая загрузка 300 документов
- [ ] Маппинг: файл -> study + document type + version
- [ ] Создание связей между документами одного исследования
- [ ] Progress bar

### 14.2. Массовый прогон

- [ ] Запуск pipeline по всем 300 документам
- [ ] Concurrency control (не перегрузить LLM провайдер)
- [ ] Progress tracking в UI

### 14.3. Batch analytics dashboard

- [ ] Метрики per stage x per document type (матрица)
- [ ] Кросс-типовая аналитика (факт X: accuracy в Protocol vs ICF vs IB)
- [ ] Гистограмма confidence distribution
- [ ] Agreement rate algo vs LLM
- [ ] Дельта с предыдущим batch run
- [ ] Подсказка: "эти документы стоит разметить" (нетипичная структура, low confidence)

**Выход**: массовый прогон и аналитика по пулу 300 документов

---

## Сводная таблица

| Фаза | Название | Длительность | Зависимости |
|------|----------|-------------|-------------|
| 0 | Подготовка | 1 нед | -- |
| 1 | Схема данных | 1 нед | Фаза 0 |
| 2 | Перенос правил/промптов в БД | 2 нед | Фаза 1 |
| 3 | API: сервисы и роутеры | 2 нед | Фаза 1 |
| 4 | Workers: evaluation jobs | 1.5 нед | Фаза 2, 3 |
| 5 | Rule-admin: каркас | 1 нед | Фаза 3 |
| 6 | UI: LLM Configuration | 0.5 нед | Фаза 5 |
| 7 | UI: Golden Dataset | 1.5 нед | Фаза 5 |
| 8 | UI: Evaluation и Dashboard | 1.5 нед | Фаза 4, 5 |
| 9 | UI: Rules & Prompts | 1.5 нед | Фаза 5 |
| 10 | UI: Disagreements и SOA | 1 нед | Фаза 5 |
| 11 | Implicit Feedback | 1 нед | Фаза 3 |
| 12 | Workflow согласования | 1 нед | Фаза 5 |
| 13 | Fact/SOA-based аудит | 1 нед | Фаза 2 |
| 14 | Batch Testing | 1 нед | Фаза 4, 7 |
| **Итого** | | **~18 нед** | |

## Параллелизация

Некоторые фазы могут выполняться параллельно:

```
Фаза 0 ──► Фаза 1 ──┬── Фаза 2 ──┬── Фаза 4 ──┬── Фаза 8
                      │             │             ├── Фаза 13
                      │             │             └── Фаза 14
                      │             │
                      └── Фаза 3 ──┼── Фаза 11
                                   │
                                   └── Фаза 5 ──┬── Фаза 6
                                                 ├── Фаза 7
                                                 ├── Фаза 9
                                                 ├── Фаза 10
                                                 └── Фаза 12
```

При параллельной работе над Фазами 2+3, затем 5+4, затем 6-12:
- **Критический путь**: ~12 недель
- **С одним разработчиком**: ~18 недель
- **С двумя разработчиками**: ~12 недель (backend + frontend)

---

## Риски

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Перенос промптов сломает текущий pipeline | Высокая | Высокое | Regression тесты ДО миграции, A/B: DB vs hardcoded |
| Batch evaluation перегрузит LLM провайдер | Средняя | Среднее | Rate limiting, concurrency control, RunPod auto-scale |
| 300 документов не влезут в один evaluation run | Низкая | Среднее | Chunked execution, progress tracking |
| Rule admin UI слишком сложный для пользователя | Средняя | Высокое | UX тестирование после Фазы 7, итеративное упрощение |
| Различие формата промптов между провайдерами | Средняя | Среднее | Абстракция в llm-gateway, provider-specific adapters |
