# План повышения качества классификации секций

Статус: предложен. Дата: 2026-05-01.

## Контекст

Этап `classify_sections` в pipeline разбора документа имеет ряд архитектурных и алгоритмических дефектов, обнаруженных при аудите. Этот план фиксирует план их устранения.

Связанные файлы (на момент составления плана):
- `apps/workers/src/handlers/classify-sections.ts` — handler этапа (3 уровня: deterministic / llm_check / llm_qa)
- `packages/rules-engine/src/section-classifier.ts` — детерминистический классификатор
- `packages/rules-engine/src/rule-adapter.ts` — адаптер DB-правил
- `packages/db/src/seed-taxonomy.ts` + `taxonomy.yaml` — источник правил
- `packages/db/src/seed-prompts.ts:613-652` — LLM-промпты в БД
- `packages/doc-parser/src/heading-detector.ts` — извлечение заголовков

## Главные находки аудита

| # | Дефект | Эффект |
|---|---|---|
| 1 | `require_patterns` / `not_keywords` из `taxonomy.yaml` грузятся в БД, но `rule-adapter.toSectionMappingRules` их **не читает**, а `SectionClassifier.classify` не имеет логики гейтов/негативов | Вся FP-min логика таксономии не работает — ложные срабатывания на `synopsis`, `definitions`, `statistics` |
| 2 | LLM-промпты в БД (`section_classification_qa` ruleSet `...204`) **не подгружаются** в handler — он использует hardcoded inline prompt | rule-admin UI бесполезен, UI ↔ runtime drift |
| 3 | Иерархия zone/subzone теряется в `toSectionMappingRules` — flat list, first-match | Subzone и parent zone конкурируют, нет учёта parent-context |
| 4 | LLM Check вызывается **на каждую** секцию, в т.ч. с `confidence=0.95` от deterministic | Дорого: 200 секций → 200 запросов |
| 5 | Confidence в deterministic фиксированный (0.95/0.7) | Не отражает качество совпадения |
| 6 | Deterministic берёт только `contentBlocks[0]`, LLM — `slice(0, 2000)` | Несогласованность уровней |
| 7 | LLM-промпт не показывает соседние решения как контекст | Теряется sequence context |
| 8 | Нет few-shot примеров в LLM-промпте | Промахи на редких/спорных зонах |
| 9 | LLM Check — 1 секция = 1 запрос (нет batch) | Медленно и дорого |
| 10 | JSON-парсинг хрупкий (`/\{[\s\S]*\}/` greedy) | Парсинг ломается на reasoning с примерами JSON |
| 11 | Двойной retry: `MAX_RETRIES=2` в handler + `step-retry` 3 попытки в orchestrator | До 9 попыток с backoff |
| 12 | Heading detector требует `isBold` для numbered | Заголовки в обычном шрифте теряются |
| 13 | Нет uniqueness constraints (singleton-зоны: `synopsis`, `references`, ...) | Возможны дубликаты |
| 14 | `analyze-corrections` создаёт `CorrectionRecommendation`, но они не feed-в в LLM как few-shot | Correction loop не замыкается |
| 15 | Нет fuzzy match в `zoneLookup` | LLM-опечатки → секции теряются в `skippedInvalidZone` |
| 16 | LLM QA-step стабильно падает: 8/8 batch'ей `TypeError: fetch failed`, totalTokens=0, corrections=0 (sample golden 5883f8c0, два независимых reprocess подряд — одинаковая поломка) | QA-стадия не отрабатывает, baseline отражает pipeline «без QA» |

## Подготовка перед стартом

1. Ветка `feat/section-classification-quality` (создаётся в начале спринта 1).
2. **Baseline на golden samples** — обязательно. Прогнать существующий evaluation на section_classification, зафиксировать precision/recall/f1. Без этого выигрыш не доказать.
3. После каждого спринта — повторный прогон evaluation и обновление `changelog.md`.
4. На каждом коммите — `npm run typecheck && npm run lint && npm test`.

## Спринт 0. Инфраструктурные блокеры (≈0.5-1 день)

Цель: починить flaky LLM QA endpoint, чтобы baseline и after-замеры отражали полный pipeline (с QA-стадией), а не «pipeline без QA из-за стабильного fetch failed».

### 0.1 — Диагностировать и починить TypeError: fetch failed в section_classify_qa

**Симптомы (sample golden `5883f8c0-b84d-4c3f-afa9-04a75becc93e`, два независимых reprocess подряд 13:30 и 13:41 на 2026-05-01):**
- llm_qa-step section_classification: 8/8 batch'ей возвращают `parseErrors: ["no_json: TypeError: fetch failed"]`
- `totalTokens: 0`, `corrections: 0`, `reviewed: 199` (батчи доехали до отправки, но fetch не вернул response)
- llm_check на той же документной партии работает (`updated: 198`, tokens ≈ 481 K)
- duration_s = 92-93 — то есть QA-step упирается в timeout, а не в auth

**Гипотезы для проверки (по убыванию вероятности):**
1. **Размер batch + context-length DeepSeek-V32:** 25 секций с preview склеиваются в payload, может превышать `maxInputTokens=30000` для `section_classify_qa` → endpoint возвращает HTTP error → `fetch failed` на стороне клиента (если LLMGateway не различает HTTP error и network error).
2. **Timeout слишком короткий:** `timeoutMs=120_000` в seed; DeepSeek с reasoning-mode `ENABLED_HIDDEN` может думать дольше при размытом контексте (~200 секций отгрузки).
3. **Endpoint flakiness / auth для конкретной модели** — `gpt://b1g1ua1ecl42sbksj2pk/deepseek-v32/latest` может иметь rate-limit или auth проблему на стороне Yandex Cloud, отдельную от `yandexgpt`.

**Файлы для расследования:**
- `apps/workers/src/handlers/classify-sections.ts:404-565` — handler llm_qa
- `packages/llm-gateway/src/*` — где именно поднимается `TypeError: fetch failed`. Проверить, ловится ли HTTP-error и логируется ли тело ответа.
- `packages/db/src/seed.ts:176-177` (LlmConfig для `section_classify_qa`)

**Шаги диагностики:**
1. Добавить детальное логирование в `LLMGateway.generate` для случая когда fetch падает: статус-код, тело ответа, длина prompt в символах/токенах.
2. Воспроизвести вручную: написать скрипт `apps/workers/scripts/debug-qa-llm.ts` — взять реальный prompt из failed batch (можно собрать из текущих секций sample 5883f8c0), вызвать LLMGateway с конфигом `section_classify_qa`, посмотреть raw ответ.
3. Если причина — context-length: уменьшить `BATCH_SIZE` в classify-sections.ts:104 с 25 до 10-15. Решает проблему ценой большего числа запросов.
4. Если причина — timeout: увеличить `timeoutMs` в LlmConfig для `section_classify_qa` до 240_000 + добавить per-batch retry с exponential backoff.
5. Если причина — endpoint/auth: попробовать другую модель из `LlmConfig` (Qwen3-235B как fallback — он уже seedится как non-default для того же taskId, см. `seed.ts:177`).

**Critère успеха:** при reprocess того же sample 5883f8c0 — QA выполняется полностью (8/8 batch'ей с реальным response), `corrections > 0` (или хотя бы `totalTokens > 0`), нет `TypeError: fetch failed` в parseErrors.

**Когда выполнять:** ДО снятия baseline. Иначе baseline зафиксируется как «pipeline без QA», и после спринта 1 разница будет включать восстановление QA — невозможно отделить эффект моих правок от эффекта починки QA. Если починка займёт > 1 дня — снять baseline сейчас с явной пометкой «no-qa», починить в спринте 3 (раздел performance) и добавить второй baseline-замер «with-qa».

**Оценка:** 4-8 ч (зависит от того, насколько глубоко придётся копать в LLMGateway).

---

## Спринт 1. Critical fixes (≈2 дня)

Цель: восстановить «потерянную» логику таксономии + сократить стоимость LLM Check без потери точности.
Ожидаемый эффект: +10-15% accuracy, −60% LLM-стоимости.

### 1.1 — `require_patterns` / `not_keywords` гейты

**Файлы:** `packages/rules-engine/src/types.ts`, `rule-adapter.ts:13-29`, `section-classifier.ts:46-94`, `__tests__/section-classifier.test.ts`.

**Изменения:**
- Расширить `SectionMappingRule` полями `requirePatterns?: string[]`, `notKeywords?: string[]`, `type?: "zone" | "subzone"`, `parentZone?: string`.
- В `toSectionMappingRules` пробросить эти поля из `cfg.requirePatterns` / `cfg.notKeywords` / `cfg.type` / `cfg.parentZone`.
- В `SectionClassifier.classify` ввести scoring (вместо first-match):
  - gate: если у правила есть `requirePatterns` и ни один не совпал в `title+content` → правило исключается.
  - штраф: если совпал `notKeyword` → confidence = max(0, score − 0.4).
  - calibrated confidence: для exact-match `min(0.99, 0.6 + 0.3 * matchLen/titleLen + 0.05 * matchCount)`, для content-match `0.65`.
  - выбирается правило с max score.

**Тесты (≥10 кейсов):**
- gate: `definitions` НЕ срабатывает на «определение НЯ» (есть not_keyword «нежелат»).
- gate: `synopsis` НЕ срабатывает на «обзор синтеза» (нет require «синопсис»).
- not_keyword: «Detailed safety considerations» получает score < «Safety Assessments».
- exact-match получает confidence ≥ 0.85, partial — < 0.8.

**Риски:** существующие тесты ожидают `confidence === 0.95` — адаптировать на ranges.

**Оценка:** 4-6 ч.

---

### 1.2 — Подгружать LLM-промпт из БД

**Файлы:** `apps/workers/src/handlers/classify-sections.ts:236, 247-268, 419, 428-441`, `packages/db/src/seed-prompts.ts:613-652`.

**Изменения:**
- В handler — параллельно с правилами загружать `loadRulesForType(ctx.bundleId, "section_classification_qa")`, искать `section_classify:llm_check` и `section_classify:qa` по `name`.
- Использовать как шаблон: `(promptDb ?? HARDCODED).replace("{{catalog}}", catalog)`.
- Обновить `seed-prompts.ts` — переписать промпты до уровня текущего hardcoded (с правилами приоритета, JSON-форматом, плейсхолдером `{{catalog}}`). Без этого подключение БД-промптов **ухудшит** качество.
- Бамп `RuleSetVersion` (создать v2 active, v1 deactivate) для тенантов с уже задеплоенной БД.

**Тесты:**
- handler с моком `loadRulesForType`, проверить, что промпт из БД попал в gateway-вызов.
- При `loadRulesForType=null` используется hardcoded fallback.

**Оценка:** 3-4 ч.

---

### 1.3 — LLM Check только на пограничные секции

**Файлы:** `apps/workers/src/handlers/classify-sections.ts:288-375`.

**Изменения:**
- Константа `HIGH_CONFIDENCE_SKIP = 0.85`.
- Фильтровать: `sections.filter(s => !s.algoSection || (s.algoConfidence ?? 0) < HIGH_CONFIDENCE_SKIP)`.
- В возврат добавить `verifiedByLlm`, `skippedHighConfidence`.

**Тесты:** 3 секции с confidence 0.95/0.7/null → LLM зовётся только на 2 последние.

**Риски:** зависит от 1.1 — если calibration снизила confidence, скип не сработает. Mitigation: инвариант-тест «exact-match чистого `Synopsis` ≥ 0.9».

**Оценка:** 1-2 ч.

---

### 1.5 — Согласовать content snippet в det/llm

**Файлы:** `apps/workers/src/handlers/classify-sections.ts:181-187`.

**Изменения:**
```ts
const CONTENT_FOR_DETERMINISTIC_CHARS = 1000;
const fullContent = section.contentBlocks.map(b => b.content).join("\n");
const contentSnippet = fullContent.slice(0, CONTENT_FOR_DETERMINISTIC_CHARS);
```

**Оценка:** 30 мин.

---

### 1.6 — Per-section метрика в evaluation для classification

**Контекст:** текущий `extractKeys` в `run-evaluation.ts:298-319` сравнивает результаты классификации по уникальным значениям `standardSection` (set-уровень). Это означает: если в документе 3 секции попали в зону `safety`, evaluation учтёт их как **одну** запись. Метрика занижена для документов с дублями зон, и реальные регрессии в рамках одной зоны (одна правильно, две ошибочно) не отражаются в f1.

**Когда выполнять:** между завершением задач 1.1-1.5 и перед замером «после-спринт-1». Без этой правки сравнение baseline ↔ after-сpринт-1 будет огрубленное.

**Файлы:**
- `apps/workers/src/handlers/run-evaluation.ts:298-319` (функция `extractKeys`)
- тесты на handler в `apps/workers/src/handlers/__tests__/run-evaluation.test.ts` (если файла нет — создать)

**Изменения:** в `extractKeys` для ключа `sections` сравнивать по паре `(title, standardSection)`, для остальных stage'ов оставить старую логику:

```ts
function extractKeys(data: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          const obj = item as Record<string, unknown>;
          if (key === "sections" && obj.title != null && "standardSection" in obj) {
            keys.add(`sections:${String(obj.title).trim().toLowerCase()}=${String(obj.standardSection)}`);
            continue;
          }
          const identifier =
            obj.factKey ??
            obj.standardSection ??
            obj.id ??
            JSON.stringify(item);
          keys.add(`${key}:${String(identifier)}`);
        } else {
          keys.add(`${key}:${String(item)}`);
        }
      }
    } else {
      keys.add(`${key}:${String(value)}`);
    }
  }
  return keys;
}
```

**Тесты:**
- 3 секции с одинаковым `standardSection='safety'` и разными title → expected/actual matching: 3 пары → 3 ключа (старая логика давала 1).
- expected `[{title:"X", standardSection:"a"}]`, actual `[{title:"X", standardSection:"b"}]` → разные ключи → recall=0 (правильно).
- title-нормализация: `"Synopsis "` и `"synopsis"` мэтчатся.

**Риски:**
- ранее снятые baseline-метрики становятся несравнимыми со старыми. Mitigation: re-run baseline с новой метрикой ДО замера after-спринт-1, чтобы оба замера были на одной шкале.
- title в expected (от эксперта) и actual (из БД) могут расходиться, если эксперт правил title секции — case-insensitive trim снимает шум, но не drastic edits. Этот edge case логировать как diff.entry.

**Оценка:** 1-2 ч.

---

## Спринт 2. Иерархия и контекст для LLM (≈2-3 дня)

### 2.1 — Иерархия zone/subzone в детерминисте

**Файлы:** `packages/rules-engine/src/section-classifier.ts`, `apps/workers/src/handlers/classify-sections.ts:181-219`.

**Изменения:**
- В classifier добавить `classifyHierarchical(sections: CachedSection[])`:
  - 1-й проход: top-level (level ≤ 1) — обычный `classify`.
  - 2-й проход: children — `classifyWithParentBoost(title, content, parentZone)`:
    - бонус +0.05, если выбрана subzone parentZone.
    - штраф −0.1, если выбрана subzone другой зоны.
- В handler заменить map-classify на `classifyHierarchical(sections)`.

**Тесты:**
- секция «Adverse Events» под parent «Safety» → выбирается `safety.adverse_events`.
- та же секция без parent → выбор по score, без бонуса.

**Оценка:** 6-8 ч.

---

### 2.2 — Соседи как контекст в LLM Check

**Файлы:** `apps/workers/src/handlers/classify-sections.ts:241-306`.

**Изменения:** заменить `topLevelOutline` на окно ±3 секции вокруг текущей с маркировкой уже присвоенных зон:
```
  Safety considerations [safety]
  Adverse Events [safety.adverse_events]
→ Reporting timelines
  Statistical Analysis [statistics]
```

**Оценка:** 2-3 ч.

---

### 2.3 — Few-shot примеры в LLM-промпте

**Файлы:** `packages/db/src/seed-prompts.ts:613-652`.

**Изменения:** в `section_classify:llm_check` добавить блок «ПРИМЕРЫ КЛАССИФИКАЦИИ» — 8-10 hand-picked пар «заголовок → правильная зона + причина», с упором на исторически путаемые границы (синопсис vs обзор, statistics vs overview, ip vs treatments).

**Оценка:** 2 ч.

---

## Спринт 3. Performance и robust parsing (≈2 дня)

### 3.1 — Batch-режим в LLM Check

**Файлы:** `apps/workers/src/handlers/classify-sections.ts:288-375`, `packages/db/src/seed-prompts.ts`.

**Изменения:**
- `BATCH_SIZE = 20`, формат entries как в QA: `[1] Title | path | preview`.
- Промпт меняется: возвращать массив `[{idx, zone, confidence}]`.
- Per-batch retry вместо per-section.

**Тесты:**
- batch из 5 → один LLM-вызов, 5 update'ов.
- batch вернул JSON с 4 элементами → одна секция остаётся с deterministic, лог warn.

**Оценка:** 4-5 ч.

---

### 3.2 — Robust JSON parser

**Файлы:** `apps/workers/src/handlers/classify-sections.ts:128-162`.

**Изменения:** заменить greedy regex на:
1. `JSON.parse(cleaned)` в try/catch (целиком).
2. `extractBalanced(s, "[", "]")` — balanced bracket parser.
3. `extractBalanced(s, "{", "}")` для объектов с `sections` / `results` / `corrections`.

**Тесты:** 4 кейса (think-tags + JSON, reasoning с примерами JSON, markdown-блок, мусор → null).

**Оценка:** 2-3 ч.

---

### 3.3 — Снять двойной retry

**Файлы:** `apps/workers/src/handlers/classify-sections.ts:105, 308-369`.

**Изменения:** `MAX_RETRIES = 0`. Полагаемся на orchestrator step-retry.

**Оценка:** 1 ч.

---

## Спринт 4. Headings, uniqueness, fuzzy resolve (≈3 дня)

### 4.1 — Numbered headings без bold

**Файлы:** `packages/doc-parser/src/heading-detector.ts:64-72`, `__tests__/heading-detector.test.ts`.

**Изменения:** ослабить требование `isBold` для numbered с гарантиями:
- numbered + (`isBold` OR (длина < 80 chars AND не заканчивается `.` или `,`) OR (dots ≤ 3 AND длина < 120)) → heading.

**Тесты:**
- `1.2 Дизайн исследования` (без bold) → heading level 2.
- `1. Согласно ГОСТ 12345, всем участникам...` → null.
- `1.1.1.1.1 Это очень глубокая иерархия` → null (dots > 3).

**Риски:** ложные срабатывания на нумерованных списках. Mitigation — порог длины + терминальные знаки.

**Оценка:** 3-4 ч (с ручной проверкой на реальных DOCX).

---

### 4.2 — Singleton constraints

**Файлы:** `packages/rules-engine/src/types.ts`, `taxonomy.yaml`, `packages/db/src/seed-taxonomy.ts`, `apps/workers/src/handlers/classify-sections.ts`.

**Изменения:**
- В `SectionMappingRule` добавить `isSingleton?: boolean`.
- В `taxonomy.yaml` пометить `synopsis`, `table_of_contents`, `references`, `title_page`, `signatures`.
- `flattenTaxonomy` пробрасывает в `config.isSingleton`.
- В handler после LLM QA — `enforceUniqueness`: для каждой singleton-зоны оставить кандидата с max confidence, остальным `standardSection=null` + `classificationComment="singleton conflict: lost to <id>"`.

**Тесты:** 3 секции, все классифицированы как `synopsis` с confidence 0.95/0.8/0.7 → остаётся одна с 0.95.

**Оценка:** 4-5 ч.

---

### 4.3 — Fuzzy resolve в zoneLookup

**Файлы:** `apps/workers/src/handlers/classify-sections.ts:36-86`.

**Изменения:** Levenshtein fallback с порогом ≤ 2 и быстрым отказом по разнице длины > 2.

**Тесты:**
- `syn0psis` → `synopsis`.
- `introducton` → `introduction`.
- `completely_unknown_zone` → null.

**Оценка:** 2 ч.

---

## Спринт 5. Correction-loop как few-shot (≈4-5 дней)

Стратегическая фича: превращает `CorrectionRecord` инфраструктуру в непрерывное улучшение.

### 5.1 — Хранение утверждённых примеров

**Файлы:** `packages/db/prisma/schema.prisma`, новая миграция `add_classification_few_shot`, сервис approve.

**Schema:**
```prisma
model ClassificationFewShot {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String?  @map("tenant_id") @db.Uuid
  sectionTitle    String   @map("section_title")
  parentPath      String?  @map("parent_path")
  contentSnippet  String?  @map("content_snippet")
  correctZone     String   @map("correct_zone")
  reason          String?
  source          String   // "manual" | "approved_correction"
  isActive        Boolean  @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @map("created_at")
  
  @@index([tenantId, correctZone])
  @@index([tenantId, isActive])
  @@map("classification_few_shots")
}
```

При approve `CorrectionRecommendation` со `stage='classification'` → создавать `ClassificationFewShot` из исходных `CorrectionRecord`.

**Migration:** `npx prisma migrate dev --name add_classification_few_shot`.

**Оценка:** 1 день.

---

### 5.2 — Подмешивание few-shot в LLM Check

**Файлы:** `apps/workers/src/handlers/classify-sections.ts:245-268`.

**Изменения:**
- Загрузить `ClassificationFewShot` для тенанта (`OR: [{tenantId}, {tenantId: null}], isActive: true`, take=100).
- Top-k=5 по Jaccard similarity (слова заголовка) к текущей секции.
- Инжектить в `userMessage` блок «ПОХОЖИЕ РУЧНО-РАЗМЕЧЕННЫЕ ПРИМЕРЫ».

**Оценка:** 1 день.

---

### 5.3 — Учёт few-shot в evaluation

**Файлы:** `apps/workers/src/handlers/run-evaluation.ts`.

**Изменения:** трекать «использован few-shot ID X для секции Y» в `EvaluationResult.metadata`. В admin UI показывать «эта неправильная классификация была сделана при наличии релевантного few-shot — нужен контр-пример».

**Оценка:** 0.5-1 день.

---

### 5.4 — UI управления few-shot

**Файлы:** `apps/rule-admin/src/app/(app)/few-shots/page.tsx` (новый).

Список + create/edit/delete + toggle isActive.

**Оценка:** 1-1.5 дня.

---

## Сводная таблица

| Спринт | Длительность | Коммитов | Главный output |
|---|---|---|---|
| 0. Инфраструктурные блокеры (LLM QA fetch failed) | 0.5-1 день | 1 | QA-стадия отрабатывает; baseline отражает полный pipeline |
| 1. Critical fixes + точная eval-метрика | 2-2.5 дня | 5 | +10-15% accuracy, −60% LLM-стоимости, per-section f1 |
| 2. Иерархия и контекст | 2-3 дня | 3 | Зоны/субзоны корректно разделены |
| 3. Performance | 2 дня | 3 | classify-sections 4-6× быстрее |
| 4. Headings + uniqueness | 3 дня | 3 | Меньше пропущенных секций, нет дубликатов |
| 5. Correction-loop | 4-5 дней | 4 + миграция + UI | Непрерывное улучшение |

**Итого:** ~13.5-17 дней, 19 коммитов, 1 миграция, 1 admin-страница.

## Риски

| Риск | Вероятность | Mitigation |
|---|---|---|
| Calibrated confidence ломает существующие tests (asserts на 0.95) | High | Адаптировать тесты на ranges; запускать testsuite после 1.1 |
| Промпты в БД (после 1.2) хуже захардкоженных | Medium | Перед мержем 1.2 — golden eval до/после; обязательно обновить seed-промпты |
| `not_keywords` штраф ловит легитимные секции | Medium | Логировать каждый штраф 2 недели, ручной аудит |
| Heading detection без bold добавляет шум | Medium | Запустить на dev-документах, сравнить кол-во секций |
| Singleton enforcement удалит правильную секцию | Low | `classificationComment` с указанием winner.id для recovery |
| Few-shot pool разрастётся → промпт-токены > budget | Low | Лимит top-k=5, общий cap 100 в pool |

## Старт

С чего начать: **задача 1.1** (`require_patterns`/`not_keywords`) — самый высокий impact и самое локальное изменение (3 файла, без API/UI/migration).
