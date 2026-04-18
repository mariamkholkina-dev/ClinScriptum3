# ТЗ: Система непрерывного улучшения качества обработки документов (Quality Improvement System)

## 1. Цель

Организовать замкнутый цикл обратной связи на всех этапах обработки документов (parsing -> classification -> extraction -> SOA detection -> audit -> generation), позволяющий rule admin через отдельный UI непрерывно улучшать качество детерминистических алгоритмов и LLM-промптов без привлечения разработчика.

---

## 2. Роли

| Роль | Права |
|------|-------|
| **rule_admin** | Полный доступ к системе качества: управление правилами/промптами, golden dataset, evaluation, вердикты. Может принимать решения самостоятельно или отправлять на согласование |
| **rule_approver** | Видит только то, что отправил rule admin. Утверждает или отклоняет изменения с комментарием |
| **writer, qc_operator, findings_reviewer** | Работают в основном приложении. Их ручные корректировки автоматически фиксируются как implicit feedback |

---

## 3. Этапы обработки, охваченные системой

| Этап | Детерминистика | LLM | Сравнение |
|------|---------------|-----|-----------|
| Parsing (разбор DOCX) | doc-parser | -- | -- |
| Classification (классификация секций) | rules-engine паттерны | LLM-классификация | algo vs LLM |
| Extraction (извлечение фактов) | rules-engine правила | LLM-извлечение | algo vs LLM |
| SOA detection & parsing | table-parser паттерны | LLM-распознавание | algo vs LLM |
| Intra-doc audit (text-based) | правила противоречий | LLM-проверка | algo vs LLM |
| Inter-doc audit (text-based) | кросс-документные правила | LLM-сверка | algo vs LLM |
| Fact/SOA-based audit (intra) | правила по фактам/SOA | LLM-проверка | algo vs LLM |
| Fact/SOA-based audit (inter) | кросс-документные правила по фактам | LLM-сверка | algo vs LLM |
| Generation (ICF/CSR) | шаблоны | LLM-генерация per section | сгенерированное vs эталонное |
| Impact analysis | -- | LLM-анализ | -- |
| Change classification | -- | LLM-классификация значимости | -- |

---

## 4. Ключевые механизмы

### 4.1. Перенос правил и промптов в БД

- Taxonomy (сейчас `taxonomy.yaml`) -> хранение в `RuleSet`/`Rule` с версионированием
- Все LLM-промпты (classification, extraction, audit, SOA, generation) -> хранение в `RuleSet`/`Rule`
- Промпты генерации per section: каждая секция ICF/CSR имеет отдельный промпт (например `icf_informed_consent_intro`, `icf_risks_section`, `csr_efficacy_summary`)
- Промпты анализа и QA хранятся отдельно для каждого task
- Привязка правил/промптов к типу документа (Protocol / ICF / IB / CSR) или глобальные
- Каждое изменение -- новая `RuleSetVersion`
- Откат к предыдущей версии через UI
- Полный audit trail: кто, что, когда менял

### 4.2. Golden Dataset

#### Процесс создания

1. Rule admin загружает документ в систему качества
2. Документ проходит полный текущий пайплайн
3. Rule admin проверяет и корректирует результаты per stage (детерминистика vs LLM)
4. При необходимости -- согласование с rule approver (per stage)
5. Утвержденные этапы фиксируются как эталонные

#### Гранулярность

- Эталон фиксируется **per stage per document**, не целиком
- Каждый этап имеет свой статус: `draft` -> `in_review` -> `approved`
- В evaluation участвуют только этапы со статусом `approved`

Пример:

| Документ | Parsing | Classification | Extraction | SOA | Audit |
|----------|---------|---------------|------------|-----|-------|
| Protocol_001.docx | approved | approved | in_review | approved | draft |
| ICF_002.docx | approved | approved | approved | -- | approved |

#### Мульти-документные golden samples

- Для inter-doc audit и impact analysis эталон -- это набор связанных документов
- Golden sample может быть привязан к одному документу (parsing, classification, extraction, SOA, intra-audit) или к группе документов (inter-doc audit, impact analysis)
- Для мульти-документных samples статус `approved` фиксируется на весь набор
- При evaluation мульти-документных samples система подтягивает все связанные документы
- Если один из документов набора обновлен -- rule admin решает, актуален ли golden sample или нужна переразметка

### 4.3. Evaluation (прогон оценки качества)

- Запуск из UI по кнопке rule admin
- Прогон golden samples через текущие правила и LLM
- Привязка к конкретной версии RuleSet + конфигурации LLM (provider, model, temperature)
- Метрики per stage: precision, recall, F1
- Детальный результат по каждому sample: ожидание vs факт, pass/fail
- Автоматическое сравнение с предыдущим прогоном: зеленое (улучшение) / красное (регрессия)

### 4.4. Сравнение LLM-моделей

- Прогон одного golden dataset через разные LLM-конфигурации (provider, model, temperature)
- Side-by-side сравнение метрик в UI
- Выбор лучшей конфигурации per stage

### 4.5. Сравнение детерминистика vs LLM (disagreement-driven)

- На каждом этапе: отображение результата алгоритма и LLM рядом
- Фильтр "только расхождения"
- Вердикт rule admin: "алгоритм прав" / "LLM прав" / "оба неправы" + корректировка
- Вердикты пополняют golden dataset

### 4.6. Implicit feedback loop (сбор корректировок пользователей)

- **Кто**: writer, qc_operator, findings_reviewer, rule_admin
- **Что фиксируется**: любая ручная правка результата системы (переклассификация секции, правка факта, правка finding, правка сгенерированного текста)
- **Запись**: `CorrectionRecord` -- этап, оригинал, исправление, роль пользователя, контекст документа
- **Агрегация**: группировка однотипных корректировок, подсчет частотности
- **Рекомендации**: система анализирует паттерны корректировок и предлагает rule admin конкретные правки в правилах или промптах
- **Приоритизация**: чем чаще корректировка -- тем выше приоритет

### 4.7. Workflow согласования (Rule Admin -> Rule Approver)

- Rule admin при внесении изменений может:
  - **Принять самостоятельно** -> изменение применяется сразу
  - **Отправить на согласование** -> создается запрос rule approver'у
- Rule approver видит **только** контекст, отправленный rule admin: изменение, обоснование, результаты evaluation
- Rule approver может:
  - **Утвердить** -> изменение применяется
  - **Отклонить** с комментарием -> возвращается rule admin'у
- Audit trail: кто инициировал, кто утвердил/отклонил, когда, комментарий

### 4.8. Массовый evaluation (batch testing)

- **Пул**: ~300 документов (100 Protocol + 100 ICF + 100 IB), связанные по исследованиям, с версиями протоколов
- **Импорт**: пакетная загрузка с привязкой к исследованию и указанием типа/версии
- **Прогон**: полный пайплайн по всем документам, включая inter-doc audit и version diff
- **Метрики**: per stage x per document type, кросс-типовая аналитика
- **Разметка**: приоритизированная -- сначала низкая confidence и расхождения algo/LLM
- **Регрессии**: автоматическое сравнение с предыдущим прогоном, показ дельты
- **Два уровня метрик**: точные (golden set с approved-разметкой) + косвенные (весь пул -- confidence, agreement rate)

### 4.9. Совершенствование SOA detection & parsing

#### Что покрывается

- Поиск SOA-таблицы в документе (отличие от других таблиц)
- Разбор структуры: определение осей (процедуры x визиты)
- Извлечение процедур с нормализацией названий
- Извлечение визитов с таймингами
- Парсинг ячеек: raw value -> нормализованное значение

#### Сложности SOA

- Многостраничные таблицы (SOA разбита на несколько таблиц)
- Merged cells
- Footnotes привязанные к ячейкам
- Нестандартные обозначения (X, checkmark, bullet, C, условные сноски)
- Несколько SOA в одном документе (основная + скрининг + follow-up)

#### Метрики

- SOA detection rate (нашли/не нашли таблицу)
- Procedure extraction accuracy
- Visit extraction accuracy
- Cell parsing accuracy

#### Прогон

Поштучно и массово по всему пулу (SOA есть как минимум в Protocol и ICF)

### 4.10. Совершенствование генерации ICF/CSR секций

#### Промпты per section

- Каждая секция ICF/CSR имеет отдельный промпт в `RuleSet`
- Rule admin редактирует промпт конкретной секции, не затрагивая остальные

#### Процесс улучшения

1. Генерация ICF/CSR по golden set протоколов
2. Сравнение сгенерированных секций с реальными документами того же исследования
3. Per section: оценка полноты (все ли факты), корректности (нет ли искажений), соответствия стилю
4. Корректировка промпта конкретной секции -> повторный прогон -> сравнение

#### Массовый прогон

- Генерация ICF по 100 протоколам -> сравнение со 100 реальными ICF
- Dashboard: какие секции генерируются хорошо, какие стабильно плохо
- Приоритизация: rule admin фокусируется на секциях с худшими метриками

#### Эталон

Реальные ICF/IB из пула -- это и есть эталон для генерации (сравниваем сгенерированное с реальным документом того же исследования)

### 4.11. Совершенствование impact analysis

#### Процесс

- MS Word формирует diff между версиями документа (детерминистический, тюнингу не подлежит)
- LLM анализирует diff и выполняет:
  - **Классификация изменений** по значимости (editorial / substantive / critical)
  - **Impact analysis**: какие секции связанных документов затронуты (Protocol v2 -> ICF секции X, Y, Z)
  - **Генерация отчета**: человекочитаемое описание изменений и рекомендаций

#### Что тюнится

- Промпт классификации значимости изменений
- Промпт определения impact на связанные документы (per document type pair: Protocol->ICF, Protocol->IB, etc.)
- Промпт генерации отчета

#### Golden dataset

- Пары версий протоколов из пула (уже есть) + реальные связанные ICF/IB
- Эталон: ожидаемая классификация изменений + ожидаемый impact list
- Rule admin размечает: "это изменение critical, затрагивает ICF секции 3, 7, 12"

#### Метрики

- Accuracy классификации значимости
- Recall impact (все ли затронутые секции найдены)
- Precision impact (нет ли ложных срабатываний)

### 4.12. Fact/SOA-based аудит (опциональный режим)

- **Два режима аудита**: text-based (текущий) и fact/SOA-based (новый), включаются/отключаются независимо per rule
- **Intra-doc**: проверка согласованности фактов и SOA внутри документа
  - Факт `primary_endpoint` имеет разные значения в разных секциях
  - Процедура в SOA не упоминается в секции procedures (или наоборот)
- **Inter-doc**: сверка фактов между связанными документами (Protocol <-> ICF <-> IB)
  - Факт `drug_dose` не совпадает между Protocol и ICF
- **Правила в RuleSet**: новые типы правил с флагами `requires_facts`, `requires_soa`
- **Зависимость**: fact/SOA-based аудит запускается только если extraction и SOA detection завершены
- **Тюнинг**: правила и промпты для fact-based аудита настраиваются через UI rule admin, evaluation по golden dataset

### 4.13. Тестирование влияния размера контекстного окна

#### Суть

Одна и та же модель с одним промптом, но разный объем входных данных -- от чанков до полного документа.

#### Режимы подачи данных

| Режим | Что передается в LLM | Когда используется |
|-------|----------------------|-------------------|
| **Chunk** | Одна секция / фрагмент | Модель с маленьким окном, или экономия токенов |
| **Multi-chunk** | Группа связанных секций | Компромисс |
| **Full document** | Весь документ целиком | Intra-audit -- максимальный контекст |
| **Multi-document** | Два+ документа целиком | Inter-audit -- Protocol + ICF в одном запросе |

#### Что тестируется

- Одна LLM, один промпт, один golden set
- Прогон с разными `max_tokens` / chunking стратегиями
- Сравнение метрик: quality vs cost vs latency

#### Dashboard показывает

| Конфигурация | Precision | Recall | F1 | Стоимость | Время |
|-------------|-----------|--------|----|-----------|-------|
| Model X, chunk 4K | 0.72 | 0.65 | 0.68 | $0.12 | 45s |
| Model X, chunk 16K | 0.81 | 0.78 | 0.79 | $0.35 | 90s |
| Model X, full doc 64K | 0.89 | 0.87 | 0.88 | $1.20 | 180s |
| Model X, 2 docs 128K | 0.92 | 0.90 | 0.91 | $2.40 | 300s |

Rule admin видит: при каком размере окна качество выходит на плато и дальнейшее увеличение не оправдано по стоимости.

#### Параметры в LLM Configuration (per task)

- `context_strategy`: `chunk` / `multi_chunk` / `full_document` / `multi_document`
- `chunk_size_chars`: размер чанка (если chunk/multi_chunk)
- `chunk_overlap_chars`: перекрытие между чанками
- `max_input_tokens`: лимит входных токенов (ограничение модели)

---

## 5. LLM Configuration

### 5.1. Полный список LLM tasks (21 task)

Каждый task имеет независимую конфигурацию провайдера, модели и промпта. Промпты анализа и QA хранятся отдельно.

| # | Task ID | Назначение | Max tokens (default) |
|---|---------|-----------|---------------------|
| 1 | `section_classify` | Классификация секций | 2048 |
| 2 | `section_classify_qa` | QA классификации при расхождении algo/LLM | 2048 |
| 3 | `fact_extraction` | Извлечение фактов | 16384 |
| 4 | `fact_extraction_qa` | QA извлечения фактов | 4096 |
| 5 | `soa_detection` | Поиск и разбор SOA-таблиц | 8192 |
| 6 | `soa_detection_qa` | QA результатов SOA detection | 4096 |
| 7 | `intra_audit` | Внутридокументный аудит (text-based) | 4096 |
| 8 | `intra_audit_qa` | QA intra-audit findings | 2048 |
| 9 | `inter_audit` | Междокументный аудит (text-based) | 8192 |
| 10 | `inter_audit_qa` | QA inter-audit findings | 4096 |
| 11 | `fact_audit_intra` | Внутридокументный аудит по фактам/SOA | 4096 |
| 12 | `fact_audit_intra_qa` | QA fact-based intra-audit | 2048 |
| 13 | `fact_audit_inter` | Междокументный аудит по фактам/SOA | 8192 |
| 14 | `fact_audit_inter_qa` | QA fact-based inter-audit | 4096 |
| 15 | `generation` | Генерация секций ICF/CSR | 8192 |
| 16 | `generation_qa` | QA сгенерированного текста | 4096 |
| 17 | `impact_analysis` | Анализ влияния изменений на связанные документы | 8192 |
| 18 | `impact_analysis_qa` | QA impact analysis | 4096 |
| 19 | `change_classification` | Классификация значимости изменений между версиями | 4096 |
| 20 | `change_classification_qa` | QA классификации изменений | 2048 |
| 21 | `correction_recommend` | Анализ паттернов корректировок -> рекомендации правок | 8192 |

### 5.2. Параметры per task

| Параметр | Описание |
|----------|----------|
| Provider | Провайдер (OpenAI, Anthropic, Azure, Qwen, YandexGPT, RunPod, custom) |
| API endpoint URL | Адрес сервера (важно для RunPod, Yandex Cloud) |
| API key | Ключ доступа |
| Model ID | Идентификатор модели (включая yandexgpt URI: `gpt://<folder_id>/model/version`) |
| Temperature | Per task (default 0.1, generation 0.3) |
| Max output tokens | Максимум токенов на ответ |
| Max input tokens | Лимит входных токенов (ограничение модели) |
| Context strategy | `chunk` / `multi_chunk` / `full_document` / `multi_document` |
| Chunk size (chars) | Размер чанка |
| Chunk overlap (chars) | Перекрытие между чанками |
| Model window (chars) | Размер окна модели (влияет на chunking) |
| Rate limit | Запросов в минуту |
| Timeout / cold start | Таймаут запроса (RunPod серверы) |
| Cost per 1K tokens | Input/output стоимость (для расчета стоимости evaluation) |
| Status | Active / inactive (можно отключить когда RunPod сервер выключен) |

### 5.3. Fallback

Если per-task конфигурация не указана -- берется default (`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`).

### 5.4. Привязка к этапам

- Per stage можно назначить default LLM config
- При запуске evaluation rule admin выбирает какую LLM config использовать (или сравнивает несколько)

### 5.5. Дополнительные функции UI

- Тест соединения: кнопка "Проверить подключение"
- Логирование стоимости: сколько потрачено на каждый evaluation run
- Отображение баланса/квоты (если API поддерживает)

---

## 6. Отдельное приложение Rule Admin

- **Новый app**: `apps/rule-admin` -- отдельное приложение, свой порт (3002)
- **Отдельная точка входа**: своя авторизация, свой layout
- **Доступ**: только роли `rule_admin` и `rule_approver`
- **API**: использует тот же tRPC API (`apps/api`), свои роутеры/процедуры

### 6.1. Экраны

| Экран | Назначение |
|-------|-----------|
| **Dashboard** | Метрики качества per stage x per document type, тренд по времени, топ проблемных мест |
| **Golden Dataset** | Список документов, статус разметки per stage, загрузка новых, пакетный импорт |
| **Golden Sample Detail** | Результаты per stage, сравнение algo vs LLM, корректировка, отправка на согласование |
| **Evaluation** | Запуск прогона, выбор RuleSet version + LLM config, A/B сравнение двух прогонов, детальный diff |
| **LLM Comparison** | Выбор моделей, side-by-side метрики per stage, сравнение context window strategies |
| **Disagreements** | Расхождения алгоритм vs LLM по этапам, фильтры, вынесение вердиктов |
| **Corrections** | Агрегированные паттерны правок пользователей, частотность, рекомендации системы |
| **Rules & Prompts** | Редактирование taxonomy и промптов per stage per document type, версионирование, откат |
| **Generation Prompts** | Редактирование промптов per section для ICF/CSR |
| **SOA** | Результаты SOA detection/parsing, корректировка, метрики |
| **Approvals** | Входящие запросы для rule approver, история решений |
| **Batch Testing** | Массовый прогон по пулу, метрики, регрессии, дельта с предыдущим прогоном |
| **LLM Configuration** | Управление провайдерами/моделями: endpoint, ключи, параметры, стоимость, привязка к этапам, тест соединения |

---

## 7. Ограничения и допущения

- Язык документов: только русский
- CI не используется -- evaluation запускается из UI
- LLM-вызовы в evaluation допустимы
- Существующие модели `TuningSession`, `*Verdict` заменяются новой системой
- Роль `rule_admin` уже существует; `rule_approver` -- новая роль
- Пул документов: ~300 (100 Protocol + 100 ICF + 100 IB), связаны по исследованиям, есть версии протоколов
- Сравнение версий документов (diff) -- через MS Word (детерминистический, тюнингу не подлежит)

---

## 8. Порядок реализации

1. Схема данных (Prisma): GoldenSample, EvaluationRun, EvaluationResult, CorrectionRecord, ApprovalRequest, LlmConfig; расширение RuleSet/Rule
2. Перенос taxonomy и всех промптов в БД с версионированием
3. API (сервисы + роутеры для системы качества)
4. Worker (evaluation jobs: single + batch)
5. Приложение `apps/rule-admin` -- каркас + авторизация
6. UI: LLM Configuration
7. UI: golden dataset management, evaluation, dashboard
8. UI: правила и промпты (включая per section generation prompts)
9. UI: disagreement view, SOA view
10. UI: LLM comparison, context window testing
11. Механизм сбора корректировок из основного приложения (implicit feedback)
12. Агрегация корректировок и рекомендации
13. Workflow согласования (rule admin -> rule approver)
14. Fact/SOA-based аудит (опциональный режим)
