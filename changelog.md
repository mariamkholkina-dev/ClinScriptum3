# Changelog

## 2026-05-04

### Evaluation: createRun теперь enqueue'ит job

`evaluationService.createRun` создавал запись в `evaluation_runs` со status=queued, но job в BullMQ не отправлял — runs, созданные через UI rule-admin → /evaluation → «Новая оценка», застревали навсегда. Старые run'ы запускались через CLI скрипты.

`apps/api/src/services/evaluation.service.ts`:
- После `prisma.evaluationRun.create` маппим `EvaluationRunType` → job name (`single` → `run_evaluation`, `batch` → `run_batch_evaluation`) и вызываем `enqueueJob` с `{ evaluationRunId }` (handler-ы ничего больше не ждут).
- `llm_comparison` и `context_window_test` пока не имеют worker handler'ов — для них логируется warning, run остаётся `queued`. Поведение прежнее, но видимое.

Tests: `apps/api/src/services/__tests__/evaluation.service.test.ts` — 5 unit-кейсов через моки prisma + queue (single/batch enqueue, llm_comparison/context_window_test no-op, return value).

### Security: `.gitignore` для локальных secret-файлов

Добавлены паттерны `*.local` и `*.local.*` в `.gitignore`. Триггер: после merge `feat/dev-server-deploy-v2` (PR #46) в `deploy/` остался untracked `restore-passwords.local.txt` — sensitive файл с паролями, который при случайном `git add -A` мог уйти в commit. Существующие `.env.local`/`.env.*.local` покрывали только env-файлы; новые паттерны закрывают любые `*.local.*` (например `deploy/restore-passwords.local.txt`, `*.local.json`, `*.local.yaml`).

### Спринт 6 SoA detection robustness (commit 8/8): real F1 metrics на /soa странице

Завершающий коммит Sprint 6 — заменяет placeholder F1 на странице `/soa` реальными метриками относительно `expectedResults` golden samples.

`apps/api/src/lib/soa-metrics.ts`:
- `ExpectedSoaResults` — lenient JSON shape для ground truth (`{ soaTables: [{ visits, procedures, cells?, footnoteAnchors? }] }`).
- `parseExpectedSoa(raw)` — best-effort парсер; возвращает null для пустого/неправильного формата, отбрасывает malformed cells/anchors.
- `computeSoaMetrics(expected, actual)` — считает 5 групп метрик:
  - `detectionAgreement`: 1 если обе стороны имеют ≥1 SoA; 0 если только одна; 1 если обе пусты.
  - `visit`/`procedure`/`cell`: precision/recall/F1 по set-сравнению (агрегированно через все таблицы — порядок таблиц не важен).
  - `footnoteLink`: PRF1 по `(procedure|visit|marker)` ключу. Null если у обеих сторон нет anchors.
- Cell normalization: `X/✓/✔/+` → `x`; `–/—/-` → `-`; всё остальное в lowercase.

`apps/api/src/services/evaluation.service.ts`:
- Новый `getSoaMetricsByGoldenSample(tenantId)` — для каждого golden sample подтягивает stage `soa_detection`, expected results, actual SoaTable + cells + footnoteAnchors (через `cell` lookup для resolved procedure/visit), и вызывает `computeSoaMetrics`.

`apps/api/src/routers/evaluation.ts`:
- tRPC `evaluation.getSoaMetricsByGoldenSample` — quality-procedure protected query без input.

UI `apps/rule-admin/src/app/(app)/soa/page.tsx`:
- Новый блок «Метрики на golden set» над фильтрами с 4 cards: Detection agreement, Visit F1, Cell F1, Footnote link F1. Усреднение через samples с expected.
- Раскрывающаяся per-sample таблица: Sample, Detect, Visits, Procedures, Cells, Footnotes — для drill-down.
- Samples без expected отображаются серым с прочерками.

Tests:
- 8 unit тестов для `parseExpectedSoa` + `computeSoaMetrics` в `apps/api/src/lib/__tests__/soa-metrics.test.ts` (perfect match, partial cell, missed detection, malformed input, footnote null edge case).

Sprint 6 завершён: 8 коммитов, ~50 новых тестов, 3 миграции (`add_soa_cell_geometry`, `add_soa_source_block_ids`, `add_soa_cell_highlight`).

### Спринт 6 SoA detection robustness (commit 7/8): LLM verification UI badges

Followup к Sprint 4 — `verificationLevel` и `llmConfidence` уже хранились на `SoaTable`, но не отображались в UI.

`apps/rule-admin/.../soa-viewer/SoaViewer.tsx`:
- Шапка таблицы (`SingleSoaTableViewer`):
  - `verificationLevel === 'llm_check'` → синий бейдж `Проверено LLM ({llmConfidence × 100}%)`.
  - `verificationLevel === 'llm_qa'` → амбер бейдж `Требует проверки LLM QA ({llmConfidence × 100}%)`.
  - `verificationLevel === 'deterministic'` → без бейджа.
  - Tooltip: «LLM Check выполнен в момент detect; уровень определяет согласие или конфликт детерминистики и LLM».
- `CellDetailPanel` теперь принимает `verificationLevel` + `llmConfidence` и показывает их в нижней метаинформации ячейки.

`apps/web/.../documents/[versionId]/page.tsx`:
- Тот же бейдж рядом с заголовком «Извлечённые данные (для валидации)» в SoaTab. Read-only.

Backend без изменений — `processing.service.getSoaData` уже возвращает все scalar поля `SoaTable` (включая `verificationLevel` и `llmConfidence`) через `findMany` без select.

### Спринт 6 SoA detection robustness (commit 6/8): yellow cell highlighting

Реальные протоколы часто отмечают важные ячейки SoA желтой подсветкой. Теперь это сохраняется в БД и отображается в UI.

Schema:
- `SoaCell.cellHighlight: String?` — hex `#RRGGBB` upper-case. Null когда подсветки нет.
- Миграция `20260504120000_add_soa_cell_highlight`. Применена в dev и test БД.

`packages/shared/src/soa-detection-core.ts`:
- Новая `extractFillFromOpenTag(openTag)` — ищет background по приоритету `bgcolor=` → inline `style="background[-color]:..."` → `data-shd-fill=`. Поддерживает hex (3/6/8 digits, alpha обрезается), `rgb()`, `rgba()`, набор named colors (yellow, red, green, blue, white, black, gray, orange, pink, magenta, cyan, lime, silver). Игнорирует `transparent`/`inherit`/`none`/`initial`/`unset`/`auto`.
- `HtmlCell.fill?: string | null` — propagated через `fillGrid` параллельно `rawHtmlGrid` в `expandGridFromHtmlRows`. `transposeCandidate` транспонирует и `fillGrid`.
- `SoaCellData.cellHighlight: string | null` — заполняется в `buildSoaResult`. `persistSoaTables` пишет `SoaCell.cellHighlight`.

UI:
- `apps/rule-admin/.../soa-viewer/SoaViewer.tsx` `SoaCell.cellHighlight` — `style={{ backgroundColor: cell.cellHighlight }}` поверх zone-color класса; tooltip «Выделено в исходном документе».
- `apps/web/.../documents/[versionId]/page.tsx` SoaTab — то же.

Tests:
- 10 unit тестов для `extractFillFromOpenTag` в `apps/api/src/lib/__tests__/soa-cell-fill.test.ts` (shared не имеет vitest setup).

### Спринт 6 SoA detection robustness (commit 5/8): native Word footnotes + trailing digit-after-marker

Два related улучшения footnote extraction в одном коммите.

**5.A — Word `word/footnotes.xml` parser:**
- Новый `packages/doc-parser/src/word-footnote-parser.ts`. Функция `extractWordFootnotes(xmlText)` возвращает `Map<id, body>` с правильным skip'ом separator/continuationSeparator footnotes (id=-1, id=0, w:type='separator'). 8 unit тестов.
- `extractTableGeometry` теперь recursively собирает `<w:footnoteReference w:id="N">` внутри каждого `<w:tc>` и сохраняет в `CellRect.footnoteRefs?: string[]`. 1 новый unit тест.
- `parser.ts` параллельно с document.xml загружает `word/footnotes.xml` в `ParsedDocument.wordFootnotes: Record<string, string>`. Best-effort — пустой объект если файла нет или парсер не получил DOCX buffer.
- `detectSoaForVersion`: после mapDrawingsToCells loop walk'ает aligned `dataGeometryReindexed` и для каждой ячейки с `footnoteRefs` создаёт pendingAnchor/footnoteDef с marker `wfn-N` (prefix защищает от коллизий с inline `1`/`*`). Body берётся из `digitalTwin.wordFootnotes`. 1 новый integration тест.

**5.B — Trailing digit after positive/symbol marker (без `<sup>`):**

Реальный кейс из протоколов: ячейка содержит `X1`, `X 1`, `X*1`, `✓2` — `1`/`2` это номер сноски, не часть значения и не часть имени `Day 1`.
- Расширил `extractCellMarkers` новым шагом trailing-digit-after-marker (regex `/^(\([XхХ]\)|[XхХ✓✔☑●+×]|[–—-])\s*(\d{1,2})\s*$/i`). Применяется после symbol-marker step — поэтому `X*1` обрабатывается двумя проходами (symbol → trailing-digit) и даёт markers `['*', '1']`.
- Защита от false positives: regex требует чтобы вся ячейка была pattern `<marker><digit>` без trailing unit-letter — `X 5mL` и `Day 1` остаются нетронутыми.
- 9 новых unit тестов: `X1`, `X 1`, `X*1`, `X1*`, `✓2`, `X 5mL` (защита), `Day 1` (защита), `– 3`, `Х1` (Cyrillic).

`apps/api/vitest.config.ts`: testTimeout/hookTimeout подняты до 30s — default 5s слишком близко к baseline 4.3-4.7s integration тестов.

### Спринт 6 SoA detection robustness (commit 4/8): merge continuation SoA tables

Word часто разрывает длинную SoA на 2-3 части `<w:tbl>` с повторённой шапкой — ранее каждая часть становилась отдельной `SoaTable`. Теперь они сливаются в одну логическую таблицу.

Schema:
- `SoaTable.sourceBlockIds: Json @default("[]")` — массив всех ContentBlock IDs continuation parts. Существующее `sourceBlockId` оставлено для backward compatibility и заполняется первым элементом.
- Миграция `20260504110000_add_soa_source_block_ids`. Применена в dev и test БД.

`packages/shared/src/soa-detection-core.ts`:
- Новый `mergeContinuationTables(tables)` — strict-equality grouping по `(sectionId, orientation, visits, headerRows)`. Внутри группы concatenation `procedures`, `matrix` rows, `rawMatrix` data rows (header rows последующих частей пропускаются), `tableDrawings`, `cellGeometry` data rows. `footnoteDefs` мерджатся по `marker` (first wins, остальные пропускаются), `footnoteAnchors` сшиваются с rowIndex offset для cell- и row-anchors.
- `detectSoaForVersion` вызывает merge между detection и persist. Лог `[soa] Merged continuation tables` с before/after.
- `SoaDetectionResult.sourceBlockIds: string[]` — новое поле; default `[candidate.blockId]` в `buildSoaResult`.
- `persistSoaTables` пишет `SoaTable.sourceBlockIds`.

Tests:
- 4 integration теста в `apps/api/src/__tests__/integration/soa-continuation-merge.test.ts`: pair merge, разные visits НЕ мерджатся, trio merge, rowIndex contiguity без коллизий. Тесты используют локальный `timeout: 30_000` (default 5s слишком близко к baseline 4.3-4.7s интеграционок).

### Спринт 6 SoA detection robustness (commit 2/8): wire mapDrawingsToCells в pipeline

Sprint 3's `mapDrawingsToCells` (`packages/shared/src/soa-detection-core.ts:994`) был pure helper готов с того спринта, но никогда не вызывался — не было источника cell EMU coordinates. Sprint 6 commit 1 добавил geometry parser; этот commit подключает его в pipeline и фактически записывает данные в БД.

Schema:
- `SoaTable.cellGeometry: Json?` — EMU geometry ячеек в canonical (visits-cols) layout. Json shape: `(CellRect | null)[][]`. Заполняется в момент detection.
- Миграция `20260504100000_add_soa_cell_geometry`. Применена в dev и test БД.

`packages/doc-parser/src/parser.ts`:
- Один `JSZip.loadAsync(buffer)` теперь парсит `word/document.xml` дважды — для drawings (existing) и для table geometries (new). Один pass экономит I/O.
- `ParsedDocument.tableGeometries: TableGeometry[]` — новое required поле. Пустой массив если parser вызван без DOCX buffer (HTML-only тесты).
- `metadata.totalTableGeometries` для observability.

`packages/shared/src/soa-detection-core.ts:detectSoaForVersion`:
- Загружает `version.digitalTwin.drawings` + `version.digitalTwin.tableGeometries`. parse-document сохраняет ParsedDocument целиком в digitalTwin (Sprint 1 поведение), теперь оттуда читаем drawings и geometries.
- Для каждой обнаруженной SoA таблицы (по positional index в `candidates`) — берём соответствующую geometry. Если orientation='visits_rows' — транспонируем geometry (новый helper `transposeGeometry`).
- Slice'ем geometry по `headerRowCount` и убираем первую колонку (procedure-name) — получаем data-rows × visits-only grid; reindex'им rowIndex/colIndex.
- Вызываем `mapDrawingsToCells(allDrawings, flatCells, 0.6)`. Для каждого override:
  - Добавляем `'arrow'`/`'line'`/`'bracket'` в `SoaCellData.markerSources` (additive — `'text'` сохраняется).
  - Если `normalizedValue === ''` — устанавливаем `'X'` с `confidence=0.85`. Никогда не перезаписываем существующий X / dash.
- `persistSoaTables` пишет `SoaTable.cellGeometry` (canonical) и `SoaTable.drawings` (фильтрованные `tableDrawings`).

Helpers:
- **`transposeGeometry(geom)`** — swap rows ↔ cols, x ↔ y, cx ↔ cy. Merged cells flatten'ятся (transposed SoA не используют merge на практике).
- **`flattenGeometryToCellRects(geom)`** — обходит grid, дропает null slots (merged-into), возвращает плоский `CellRect[]` для `mapDrawingsToCells`.

5 integration тестов в `apps/api/src/__tests__/integration/soa-drawings-wire.test.ts`:
1. Empty digitalTwin → no crash, cellGeometry null, drawings []
2. Geometry persists in `SoaTable.cellGeometry` JSON column
3. Horizontal arrow over Drug administration row → cells получают `markerSources: ['arrow']` + `normalizedValue='X'` с confidence 0.85
4. Arrow над уже X-ячейками → markerSources additive (`['text', 'arrow']`), normalizedValue остаётся 'X', confidence не понижается
5. Image drawings игнорируются — markerSources остаются `['text']`

Все 24 SoA api тестов зелёные, full monorepo typecheck чист.

### Процесс: параллельные Claude-сессии через git worktree

Раньше несколько одновременных сессий Claude Code в одной директории `C:\Users\0\ClinScriptum3` ломали друг другу working tree: `git checkout` одной откатывал чужие правки, `git stash` сгребал чужие uncommitted-изменения, `commit` мог уйти на ветку, на которую только что переключилась параллельная сессия.

Решение — по одному git worktree на каждую активную ветку. Создано 8 worktree рядом с основным checkout:

- `ClinScriptum3-master` (master, для hotfix/review)
- `ClinScriptum3-scratch` (новая `feat/scratch` от master, под ad-hoc задачи)
- `ClinScriptum3-soa-cleanup-legacy`, `ClinScriptum3-soa-llm-verification`, `ClinScriptum3-soa-drawings`, `ClinScriptum3-soa-orientation` (активные SoA фичи)
- `ClinScriptum3-fact-extraction-followups`, `ClinScriptum3-dev-server-deploy`

`CLAUDE.md`:
- Новый раздел `## Parallel Claude Code Sessions` — таблица существующих worktree, команды создания/удаления, ограничения (один бранч в одном worktree, общие порты dev-серверов, общие docker-сервисы).
- В `### Common gotchas` — строка про `npm ci` + `db:generate` при первом запуске в свежем worktree (node_modules и Prisma client лежат per working tree, не в общем `.git`).
- В `## Development Process (Plan & Act)` — шаг 0 «Pick the worktree» перед Plan.

Каждая Claude-сессия теперь запускается из своей директории; общая `.git`, изолированный working tree, push/pull/PR работают как обычно.

### Final baseline после Sprint 0–5 — обнаружена регрессия

`docs/baselines/final-baseline-post-sprint-5-2026-05-04.json` (запуск через `apps/workers/scripts/run-baseline-evaluation.ts`):

| Stage | avgPrecision | avgRecall | avgF1 | Δ vs after-rerelabel-2026-05-02 |
|---|---|---|---|---|
| classification | 0.496 | 0.591 | **0.529** | **−0.461** |
| parsing | 1.000 | 0.000 | 0.000 | −0.000 |

Per-sample classification f1: FNT-AS-III-2026 `0.573`, STP-08-25 `0.393`, VLT-015-II/2025 `0.592`, Тетра-AHAGGN-11/25 `0.557`. Все четыре failed (порог `f1 ≥ 0.8`).

Предыдущий baseline (после re-разметки эталонов 2026-05-02) был `f1=0.990`. Текущая регрессия −0.46 по f1. Возможные причины:
- Reprocess документов 2026-05-04 шёл при исчерпанной квоте YandexGPT (`429 ResourceExhausted: 10 requests`) — часть LLM Check ушла в fallback / no-op, секции получили deterministic-only классификацию.
- `metrics.fewShots.activeCount = 0`, `zonesCovered = 0` — few-shot примеры из Sprint 5 не задействованы в evaluation. Возможно отсутствует подмешивание в LLM Check либо нет approved few-shots в БД на dev.
- Параллельные изменения в `feat/soa-sprint-6` могли затронуть детектор/handler классификации.

**Парсинг recall=0** — это известно: `evaluation_results.parsing` не сравнивает structure с эталоном, только проверяет наличие документа. Не рассматривается как регрессия.

**Status:** Final baseline зафиксирован, регрессия известна. Расследование причин и восстановление f1 — отдельная задача (см. memory `project_classification_quality_state.md`).

Run ID: `337328af-533f-465b-af49-2ac7b2448723`. Compared-to: `7761187e-b746-40c1-bd93-42da50a9a9a3` (after-rerelabel-2026-05-02).

## 2026-05-03

### Спринт 6 SoA detection robustness (commit 1/8): table-geometry парсер

`packages/doc-parser/src/table-geometry.ts` (новый, ~230 строк). Извлекает EMU-координаты ячеек из `word/document.xml` для будущего вызова `mapDrawingsToCells` (Sprint 3 helper, готов с того спринта но не имел источника координат).

API:
- **`extractTableGeometry(documentXml: string): TableGeometry[]`** — pure-функция, принимает raw XML строку, возвращает массив с одной записью на каждый top-level `<w:tbl>` в порядке появления в документе. Каждая запись = `{ tableIndex, cells: (CellRect | null)[][] }`.
- Тип **`CellRect`** — `{ rowIndex, colIndex, xEmu, yEmu, cxEmu, cyEmu, colSpan?, rowSpan? }`. Структурно совместим с `CellRect` в `@clinscriptum/shared` (Sprint 3) для последующего вызова `mapDrawingsToCells`.

Что парсит:
- `<w:tblGrid>` → `<w:gridCol w:w="DXA">` для x-координат колонок (DXA → EMU = `× 635`).
- `<w:tr>` → `<w:trHeight w:val="..." w:hRule="auto|exact|atLeast">` для y-координат. При отсутствии или `hRule="auto"` без значения — fallback на `14pt × 12700 EMU/pt`.
- `<w:tc>` → `<w:gridSpan>` для colspan; `<w:vMerge w:val="restart|continue">` для rowspan. Top-left ячейка получает полный bounding box на весь span; covered slots = `null`.
- Nested tables в `<w:tc>` — игнорируются (drawings внутри nested table останутся attribut'ами outer table в Sprint 6 commit 2 wire-up).

Tests `packages/doc-parser/src/__tests__/table-geometry.test.ts` — 11 кейсов: malformed XML, no tables, 5-col tblGrid с разными widths, missing trHeight (fallback на default), mixed exact/auto rows, nested table skip + sequential top-level tables, gridSpan colspan (top-left + nulls), vMerge rowspan (restart + continuation null), multi-row y-stacking, empty tblGrid, корректность row/col indices.

Re-export через `packages/doc-parser/src/index.ts`. Все 200+ doc-parser тестов проходят, typecheck чист.

Sprint 6 commit 2 wire-up `mapDrawingsToCells` в `detectSoaForVersion` использует эту функцию.

### UX: breadcrumb родителей в Diff overlay (Парсинг и Классификация)

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/parsing-viewer/utils.ts`:
- Новая функция `getParentChain(sectionId, sections): Section[]` — возвращает цепочку родителей секции от корня. Re-export'нута в classification-viewer/utils.

`ParsingTreeViewer.tsx` + `ClassificationTreeViewer.tsx`:
- В каждой строке Diff overlay над label («Лишняя» / «Пропущено» / «Неверный уровень» / «Неверная секция») добавлен breadcrumb родителей через `›`. Помогает эксперту быстро понять контекст: например, «ОБОСНОВАНИЕ ИССЛЕДОВАНИЯ › Литературные источники» → строка «1 шаг титрации».
- Для `missing` entries breadcrumb недоступен (секции в документе нет).

### UX: убрать disabled-блокировку quick-fix кнопок в Diff overlay

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/parsing-viewer/ParsingTreeViewer.tsx` + `classification-viewer/ClassificationTreeViewer.tsx`:
- Удалён `disabled={fixPending}` со всех per-row кнопок и select'ов в Diff overlay (5 мест в parsing, 2 в classification).
- При активной мутации UI больше не серится и не блокирует следующие клики. Optimistic update уже даёт мгновенный feedback, а tRPC/React Query параллельно обрабатывает несколько `mutate()` вызовов без побочных эффектов.

### Fix: рудимент `ip.preclinical_data` в Tenant default + БД cleanup

`packages/db/prisma/schema.prisma`:
- Default для `TenantConfig.excludedSectionPrefixes` сменён с `ip.preclinical_data` на `ip.preclinical_clinical_data` (zone была переименована в PR-9, default остался старый).

Миграция `20260503190000_rename_excluded_prefix_preclinical`:
- `ALTER TABLE tenant_configs ALTER COLUMN excluded_section_prefixes SET DEFAULT [...preclinical_clinical_data]` для новых tenants.
- `UPDATE tenant_configs / studies SET array_replace(...)` — обновляет существующие записи.
- `DELETE FROM rules WHERE pattern LIKE 'ip.preclinical_data%'` — убирает stale записи в `RuleSet`, чтобы help-dialog в rule-admin не показывал старый ключ. Свежие записи вернутся при следующем seed taxonomy (`npm run db:seed`).

После deploy на dev обязательно выполнить:
```bash
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml exec api npm run seed --workspace=@clinscriptum/db
```

Проверены все остальные актуальные зоны: `visit_schedule`, `preclinical_clinical_data`, `comparator`, `contraception_requirements` (parent procedures), `lifestyle` — все корректны в `taxonomy.yaml` и используются в коде с актуальными ключами.

### UX: optimistic update в Classification Diff overlay

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/classification-viewer/ClassificationTreeViewer.tsx`:
- Мутации `updateClassification` (standardSection секции) и `updateExpected` (эталон) переведены на optimistic update — клик «Применить» / «Принять в эталон» / «Удалить из эталона» в Diff overlay и в SectionClassificationEditor обновляет UI мгновенно, без 1–2 сек ожидания на refetch getVersion / goldenSample.
- Invalidate только на onError (race-fix как в parsing-viewer): при быстрых параллельных кликах refetch завершившейся мутации не перезаписывает кеш данными до применения других pending мутаций.

### UX: группировка zone select в Diff overlay Классификации

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/classification-viewer/ClassificationTreeViewer.tsx`:
- Добавлен helper `GroupedZoneOptions` — рендерит `<optgroup>` per-zone с алфавитной сортировкой subzones внутри (русская локаль).
- Применён в двух местах: select на строке Diff overlay (был flat-список всех zones+subzones подряд) и в `SectionClassificationEditor` (был optgroup без сортировки).
- Зоны без subzones показываются как одиночные `<option>` без optgroup-обёртки, чтобы не было пустых групп.

### Fix: исключить isFalseHeading из генерации эталонного JSON

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/page.tsx`:
- `generateExpectedJson` для этапов `parsing` и `classification` теперь фильтрует `s.isFalseHeading !== true` перед маппингом. Раньше ложные заголовки попадали в эталонный JSON, и diff потом показывал их как «Пропущено» (в actual их нет — diff-utils их фильтрует, в expected были — расхождение).

### Fix: лимит 200 секций в bulk-update мутациях

`apps/api/src/routers/processing.ts`:
- `bulkUpdateSectionStructureStatus` и `bulkUpdateSectionClassificationStatus` подняли лимит `sectionIds.max` с 200 до 1000. У реальных протоколов нередко 200+ секций (например, 225 в текущем golden-sample), и кнопка «Подтвердить» с «Выделить все» падала с 400 без видимой ошибки в UI.

### UX: разрешение дубликатов title в Diff overlay Парсинга

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/parsing-viewer/`:
- `DiffEntry` получил поле `actualSectionId?: string` — id реальной секции для extra/wrong_level записей. Без него при дубликатах title в документе нельзя было однозначно сопоставить запись overlay с конкретной секцией дерева.
- `ParsingDiffOverlay` теперь резолвит секцию по `actualSectionId` (приоритет) и только при отсутствии — fallback на title-map. Это чинит сценарий когда у документа есть несколько секций с одинаковым названием — после пометки одной копии «Не заголовок» вторая корректно остаётся в overlay (раньше была неоднозначность какая копия попала в diff).
- В строке overlay добавлен бейдж `№<numbering>` (иерархическая нумерация как в дереве) — эксперт сразу видит, какая именно секция в документе попала в diff. Полезно когда в документе несколько секций с одинаковым title (например, повторяющиеся «1 шаг титрации (на день 4)» в разных частях документа).
- Кнопка прыжка `↳` теперь ведёт ровно к той секции, что в overlay (а не к последней с таким title).

### Fix: race condition в optimistic update Diff overlay

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/parsing-viewer/ParsingTreeViewer.tsx`:
- Убран `invalidate` из `onSettled` обоих мутаций (`markFalseHeading`, `updateExpected`). При быстрых последовательных кликах `invalidate` завершившейся мутации запускал refetch, который перезаписывал кеш данными до того как сервер успел применить ещё pending мутации — optimistic-патчи терялись и строки в overlay не исчезали.
- `invalidate` теперь делается только в `onError`, для синхронизации с сервером после неудачи. Поскольку наш optimistic patch идентичен ожидаемому состоянию сервера, явный refetch на success не нужен.

### Спринт 5 SoA cleanup — итог

**Commit 1/2 — drop legacy SoA footnote fields and endpoints:**

`SoaTable.footnotes: Json string[]` и `SoaCell.footnoteRefs: Json number[]` были помечены `@deprecated` в Sprint 1 и работали как backward-compat fallback через шим-функции. Шимы удалены, колонки дропнуты, deprecated-endpoints `processing.updateSoaCellFootnoteRefs` / `updateSoaTableFootnotes` удалены вместе с service-методами. `SoaFootnote` / `SoaFootnoteAnchor` (Sprint 1) — единственное хранилище.

- Миграция `20260503180000_drop_legacy_soa_footnote_fields` (`ALTER TABLE … DROP COLUMN`). Применена в dev и test БД.
- `apps/api/src/routers/processing.ts` — удалены legacy endpoints вместе с импортом `logger`.
- `apps/api/src/services/processing.service.ts` — удалены методы-шимы.
- `apps/api/src/services/soa-footnote.service.ts` — удалены `syncLegacyTableFootnotes` и `syncLegacyCellFootnoteRefs` helpers и все их вызовы (cascade FK на анкорах справляется сам).
- `packages/shared/src/soa-detection-core.ts` — удалено deprecated поле `SoaDetectionResult.footnotes: string[]`, `persistSoaTables` упрощён.
- `apps/rule-admin/.../SoaViewer.tsx` — удалён `SoaCell.footnoteRefs`. Маркер-суперскрипт на ячейке теперь рендерится через `cellIdToMarkers` Map из `table.soaFootnotes[].anchors`. Helper `buildOrderToMarker` удалён.
- Тесты: legacy-shim describe-блоки и assertions на удалённые поля удалены/переписаны.

**Commit 2/2 — golden-set SoA metrics page:**

`apps/rule-admin/src/app/(app)/soa/page.tsx` — полная замена placeholder. 4 summary-карточки, фильтры по типу документа и статусу, таблица всех SoA-таблиц tenant'а с метриками (score, visits/cells/footnotes/anchors/drawings counts, orientation badges, verification level + LLM confidence %, status, link на golden-dataset).

Новый endpoint `processing.listSoaTablesOverview` в API: один запрос с `_count` per SoaTable, nested select по docVersion → document → study. Реальные F1 метрики (precision/recall на ячейках/визитах/процедурах/сносках) откладываются — нужна evaluation infrastructure с expected golden samples.

UI extraction в shared package остаётся как followup: ~830 строк рефакторинга `SoaViewer` + workspace setup, экономнее делать отдельным спринтом когда apps/web SoaTab будет готов потреблять shared component.

Sprint 5 завершён. Все 5 спринтов SoA-инициативы (footnotes → orientation → drawings → LLM verification → cleanup) merged в master.

### Optimistic update в Diff overlay Парсинга

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/parsing-viewer/ParsingTreeViewer.tsx`:
- `markFalseHeading` и `updateExpected` мутации переведены на optimistic update (onMutate → cancel + getData snapshot + setData → onError откат → onSettled invalidate).
- UI обновляется мгновенно, без 1-2 секунд ожидания на сетевой round-trip + повторную загрузку всех секций с блоками контента. При ошибке мутации откатываемся к снимку.

### Интерактивный Diff с эталоном на этапе Парсинг

`packages/db/prisma/schema.prisma` + миграция `20260503150000_add_section_false_heading`:
- `Section.isFalseHeading: Boolean @default(false)` — флаг «парсер ошибочно выделил абзац как заголовок». Каскадно скрывает секцию из всех структурных diff (Парсинг + Классификация).

`apps/api/src/services/document.service.ts` + `routers/document.ts`:
- Новый сервисный метод `markSectionFalseHeading(tenantId, sectionId, value)` с `requireTenantResource()`.
- Новая tRPC процедура `document.markSectionFalseHeading`.
- `getVersion` (Prisma + raw fallback) теперь возвращает поле `isFalseHeading`.
- 4 сервисных теста: установка/снятие флага, cross-tenant rejection, NOT_FOUND.

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/parsing-viewer/`:
- `utils.ts.diffWithExpected` — отфильтровывает `isFalseHeading=true` секции из `extra` и `wrong_level`.
- `ParsingTreeViewer.tsx` — `DiffOverlay` переписан как **`ParsingDiffOverlay`** с inline-действиями:
  - **Лишние**: «Принять в эталон» (добавить запись в `expected_results.sections`) или «Не заголовок» (Section.isFalseHeading=true).
  - **Пропущенные**: «Удалить из эталона» (убрать запись).
  - **Неверный уровень**: select уровней + «Применить уровень в эталон» (синхронизировать `expected.level` с фактическим).
  - На каждой строке кнопка `CornerDownRight` — прыжок к строке в основной структуре документа (сброс фильтров → раскрытие parent'ов → scroll + focus).
- В `SectionTreeRow`: для `isFalseHeading=true` — серый стиль с line-through, бейдж «Не заголовок», кнопка-тоггл (Eye / EyeOff) для отката решения.
- `goldenSampleId / stageKey / stageStatus` пропсы пробрасываются из `StageDataViewer`, нужны для `goldenDataset.updateStageStatus` мутации.

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/classification-viewer/`:
- `utils.ts.diffClassificationWithExpected` — то же фильтр `!isFalseHeading` (каскад от Парсинга).
- `ClassificationTreeViewer.tsx` — секции с `isFalseHeading` тоже серятся в дереве с бейджем.

### Спринт 4 SoA LLM verification (commit 2/2): pipeline-интеграция

`apps/workers/src/lib/soa-llm-verification.ts` (новый):
- **`verifySoaTablesForVersion(versionId)`** — пробегает по `SoaTable[]` версии и для каждой запрашивает LLM Check через `LLMGateway` (env `LLM_SOA_VERIFY_*` с fallback на общий `LLM_*`). Промпт: «You verify Schedule of Assessments tables…». Ответ парсится как `{is_soa, confidence, reasoning?}`.
- Disabled по умолчанию через `LLM_SOA_VERIFY_ENABLED=false` — детерминистический pipeline остаётся без изменений.
- При **agreement** (LLM `is_soa=true`) → `verificationLevel='llm_check'`, `llmConfidence` из ответа.
- При **disagreement** (детектор сохранил таблицу, но LLM `is_soa=false`) → `verificationLevel='llm_qa'` — флаг для оператора.
- Ошибки LLM логируются и **не валят pipeline** — verification advisory.

`apps/workers/src/handlers/run-pipeline.ts` — после `detectSoaForVersion` вызывает `verifySoaTablesForVersion(versionId)`.

`.env.example` — секция «LLM: SoA verification (Sprint 4)» с `LLM_SOA_VERIFY_ENABLED|PROVIDER|API_KEY|MODEL|TEMPERATURE`.

Тесты `apps/workers/src/lib/__tests__/soa-llm-verification.test.ts` — 8 кейсов на парсер LLM-ответа и user-message builder.

Sprint 4 завершён.

### Спринт 4 SoA LLM verification (commit 1/2): schema для уровней проверки

`packages/db/prisma/schema.prisma`:
- Новый enum `SoaVerificationLevel`: `deterministic` | `llm_check` | `llm_qa`. Это пятизуровневая модель из CLAUDE.md, применённая к SoA-этапу: уровень меняется по мере того как pipeline проходит проверки.
- `SoaTable.verificationLevel: SoaVerificationLevel` (default `deterministic`) — высший уровень, на котором подтверждена данная SoA-таблица.
- `SoaTable.llmConfidence: Float?` — уверенность, отчётливая LLM Check шагом (0..1). Null до того как llm_check отработал.

Миграция `20260503140000_add_soa_verification_level` — `CREATE TYPE` + `ALTER TABLE`. Применена в dev и test БД.

Цель спринта: добавить LLM-уровни проверки SoA по образцу того, что уже работает для классификации секций. Pipeline-интеграция — следующий коммит.

### Спринт 3 SoA drawings (commit 4/4): UI бейджи и индикаторы графических маркеров

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/soa-viewer/SoaViewer.tsx`:
- Тип `SoaCell` дополнен `markerSources: ('text'|'arrow'|'line'|'bracket')[]`. Тип `SoaTable` дополнен `drawings: DrawingUI[]` (с `position`, `direction`, `prstGeom`).
- В шапке `SingleSoaTableViewer` — бейдж «Графика: N» (синий), показывается когда у таблицы есть распознанные drawings. Title-tooltip с deтальной подсказкой.
- На ячейке — иконка `→` (для arrow) или `│` (для line/bracket) в верхнем-левом углу, если `markerSources` содержит не-text источник. Tooltip «Получено из arrow/line/bracket».
- В `CellDetailPanel` — строчка «Источник: …» с перечислением не-text источников, чтобы писатель мог увидеть откуда взялся маркер.

`apps/web/src/app/(app)/documents/[versionId]/page.tsx`:
- В шапке каждой SoA-таблицы под бейджами orientation добавлен синий бейдж «Графика: N» с тем же tooltip.

Бейджи и иконки — read-only display. SVG-overlay со стрелками поверх ячеек не рендерится, поскольку EMU→px конвертация требует точных координат таблицы в браузере, что не входит в scope этого спринта (см. commit 3/4 — mapDrawingsToCells готов как контракт, но не активирован в pipeline). Когда EMU-координаты ячеек станут доступны, overlay добавится поверх существующего UI без переписывания типов.

Sprint 3 SoA drawings — завершён. 4 коммита, 192 теста doc-parser зелёные, full monorepo typecheck зелёный. Что осталось интегрировать в production: парсинг `<w:tblGrid>` + `<w:trHeight>` для cell EMU-координат, передача `ParsedDocument.drawings` через worker `parse_document` в `detectSoaForVersion`, фактический вызов `mapDrawingsToCells` и запись `markerSources` для покрытых ячеек. Это отдельный followup.

### Спринт 3 SoA drawings (commit 3/4): mapDrawingsToCells helper + integration

`packages/doc-parser/src/parser.ts` — `parseDocx` теперь после mammoth-обработки вызывает `extractDrawings(buffer)` (best-effort, ошибки не валят парс) и кладёт результат в `ParsedDocument.drawings: Drawing[]`. `metadata.totalDrawings` добавлено для observability.

`packages/shared/src/soa-detection-core.ts`:
- Тип `MarkerSource = 'text' | 'arrow' | 'line' | 'bracket'`. `SoaCellData` расширен `markerSources: MarkerSource[]` — список сигналов, которые внесли вклад в маркировку ячейки. По умолчанию `['text']`, не меняет существующее поведение детектора.
- `persistSoaTables` теперь пишет `markerSources` в `SoaCell.markerSources` JSON-колонку.
- **`mapDrawingsToCells(drawings, cells, overlapThreshold=0.6)`** — новая pure-функция (export). Принимает массив `DrawingForMapping` и `CellRect[]` (EMU bounding boxes ячеек), возвращает `CellMarkerOverride[]` — пары `(rowIndex, colIndex, source)`. Правило перекрытия: ячейка считается покрытой когда ≥60% её площади в bounding box drawing. Image и shape игнорируются.

Привязка drawings к ячейкам не активирована в pipeline в этом коммите — это контракт для будущего Sprint 3.5/4: чтобы вызвать функцию, нужны EMU-координаты ячеек таблицы, которые требуют отдельного парсинга `<w:tblGrid>` + `<w:trHeight>`. Pure-функция готова и протестирована mentally; integration с реальным DOCX откладывается.

`ParsedDocument` теперь содержит `drawings: Drawing[]` (новое обязательное поле). Worker `parse_document` будет передавать этот массив в `detectSoaForVersion` после Sprint 3.5 — пока поле проходит транзитом.

192/192 теста doc-parser зелёные, full monorepo typecheck зелёный.

### Спринт 3 SoA drawings (commit 2/4): парсер DrawingML в doc-parser

`packages/doc-parser/src/drawing-parser.ts` (новый модуль). Извлекает графические объекты из `word/document.xml` — стрелки, линии, скобки, картинки. Использует `JSZip` для распаковки DOCX и `fast-xml-parser` для XML (новые dependencies).

API:
- **`extractDrawings(buffer): Promise<Drawing[]>`** — топ-уровневый вход: `JSZip.loadAsync` → читает `word/document.xml` → парсит → возвращает массив.
- **`extractDrawingsFromDocumentXml(xml): Drawing[]`** — pure-функция; принимает строку XML, возвращает drawings. Используется для unit-тестов с inline фикстурами.

Каждый `Drawing`:
- `type`: `'arrow' | 'line' | 'bracket' | 'image' | 'shape'` — классифицируется по `<a:prstGeom prst="...">`. Whitelist'ы для arrow (`rightArrow`, `leftRightArrow`, `bentArrow`, …), line (`straightConnector1`, `bentConnector*`), bracket (`leftBracket`, `bracePair`, …).
- `position: { xEmu, yEmu, cxEmu, cyEmu }` — координаты в EMU (English Metric Units, 914400 на дюйм). Для floating-объектов (`<wp:anchor>`) берутся из `<a:off>`/`<a:ext>`, для inline — `<wp:extent>` плюс runtime-baseline (offset = 0).
- `direction: 'horizontal' | 'vertical' | undefined` — на основе соотношения cx/cy (≥2× → доминирующая ось).
- `paragraphIndex: number` — индекс родительского `<w:p>`, для будущей привязки к таблице.
- `prstGeom?: string` — raw OOXML preset name для отладки.

Поддержано: DrawingML (`<wp:anchor>`/`<wp:inline>` → `<a:graphic>` → `wps:wsp`/`pic:pic`), `<mc:AlternateContent>/Choice` (DrawingML branch), вложенность в `<w:tbl>`. VML (`<v:shape>`) детектируется но не разворачивается — DrawingML ветка содержит ту же геометрию.

Тесты `packages/doc-parser/src/__tests__/drawing-parser.test.ts` — 12 кейсов: пустой/невалидный XML, отсутствие drawings, rightArrow/leftRightArrow/straightConnector/leftBracket/pic:pic, paragraph index, вложенность в таблицу, DrawingML branch в AlternateContent, fallback на `<wp:extent>` при отсутствии `<a:xfrm>`. Все 144 теста doc-parser зелёные.

### Спринт 3 SoA drawings (commit 1/4): schema для графических маркеров

`packages/db/prisma/schema.prisma`:
- `SoaTable.drawings: Json` (default `[]`) — массив сырых drawings, извлечённых из `word/document.xml` (стрелки, линии, скобки поверх SoA-таблицы). Формат `{ type, position: {xEmu,yEmu,cxEmu,cyEmu}, direction? }`. Используется UI для рендера SVG-overlay.
- `SoaCell.markerSources: Json` (default `["text"]`) — массив источников, которые внесли свой вклад в маркировку ячейки: `'text'`/`'arrow'`/`'line'`/`'bracket'`. Если в ячейке текстового X нет, но через неё проходит стрелка — `markerSources=['arrow']` и значение нормализуется как X с confidence 0.85.

Миграция `20260503130000_add_soa_drawings` — добавляет два JSON-столбца. Применена в dev и test БД.

Цель спринта: распознавать ячейки SoA, помеченные не текстом X, а **горизонтальной стрелкой** поверх группы ячеек (как в реальном протоколе из примера пользователя — `Прием препарата² ←→` от Визит 1 до Визит 4). Раньше такие ячейки выглядели пустыми. Логика парсинга drawings и геометрический mapping — следующие коммиты.



### Спринт 2 SoA orientation (commit 3/3): UI бейджи и conflict-алёрт

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/soa-viewer/SoaViewer.tsx`:
- Тип `SoaTable` дополнен полями `orientation` и `orientationConflict`.
- Бейджи в шапке `SingleSoaTableViewer`: «Транспонирована» (фиолетовый, `visits_rows`), «Ориентация ?» (серый, `unknown`), «Конфликт ориентации» (янтарный, `orientationConflict=true`). У каждого `title=...` с пояснением.
- Алёрт уровня документа в `SoaStageViewer`: если хотя бы у одной видимой SoA-таблицы `orientationConflict=true`, показывается янтарный блок с иконкой `AlertTriangle` — «В документе обнаружены таблицы с разной ориентацией; приоритет отдан таблицам с визитами в столбцах».

`apps/web/src/app/(app)/documents/[versionId]/page.tsx`:
- Под заголовком «Валидация SoA» каждой таблицы — те же три бейджа orientation в компактном виде, с теми же подсказками.

Все 17 typecheck-задач зелёные, lint без новых errors.

### Спринт 2 SoA orientation (commit 2/3): детектор + транспонирование в каноническую форму

`packages/shared/src/soa-detection-core.ts`:

- **`detectOrientation(rows)`** — pure-функция, эвристика на основе тех же `HEADER_SIGNALS` и `PROCEDURE_ROW_PATTERNS`, что используются в scoring. Считает visit-сигналы и procedure-сигналы отдельно для первой строки и первого столбца, сравнивает суммы `(visitsInRow + proceduresInCol)` vs `(visitsInCol + proceduresInRow)`. Margin меньше 30% от total → возвращает `unknown`. Иначе возвращает доминирующую ориентацию.
- **`transposeCandidate(candidate)`** — возвращает новую `TableCandidate` с транспонированными `rows`, `rawHtmlGrid`, `htmlRows`. Colspan/rowspan уплощаются до 1×1 — для transposed SoA-таблиц merged cells на практике не встречаются.
- **Интеграция в `detectSoaForVersion`**: для каждого кандидата сначала `detectOrientation`, затем при `visits_rows` — `transposeCandidate`, и только потом `scoreTable` + `buildSoaResult` (которые предполагают канонический layout). `result.orientation` хранит **исходную** ориентацию (для UI бейджа "Транспонировано автоматически" в Sprint 2.3).
- **Mixed-orientation guard**: после сбора всех `SoaDetectionResult`-ов, если в наборе есть и `visits_cols` и `visits_rows` (и не только `unknown`) — `orientationConflict=true` для всех **не-`visits_cols`** таблиц. UI покажет алёрт «несколько SoA с разной ориентацией, выбрана с visits в колонках».
- `persistSoaTables` записывает оба новых поля в БД.

Интеграционный тест `apps/api/src/__tests__/integration/soa-orientation.test.ts` (новый) — 5 кейсов:
- canonical layout сохраняет `orientation='visits_cols'`, `orientationConflict=false`;
- transposed layout детектируется как `visits_rows`, транспонируется в каноническую форму (визиты попадают в `headerData.visits`, процедуры — на ось ячеек);
- mixed-orientation документ → `orientationConflict=true` для visits_rows таблицы, false для visits_cols.

Все 176 api тестов зелёные, full monorepo typecheck и lint без новых errors.

### Спринт 2 SoA orientation (commit 1/3): schema + migration

`packages/db/prisma/schema.prisma`:
- Новый enum `SoaOrientation` со значениями `visits_cols | visits_rows | unknown`.
- В `SoaTable` добавлены поля `orientation: SoaOrientation @default(visits_cols)` (каноническая ориентация для всех downstream-консьюмеров) и `orientationConflict: Boolean @default(false)` — флаг для UI чтобы показать алёрт «несколько SOA с разной ориентацией, выбрана с визитами в колонках».

Миграция `20260502231259_add_soa_orientation`: `CREATE TYPE` + `ALTER TABLE soa_tables ADD COLUMN`. Применена в dev и test БД.

Цель спринта (по плану в `~/.claude/plans/spicy-tinkering-pearl.md`): автоматически распознавать таблицы с visits в строках вместо колонок, транспонировать в каноническую форму для дальнейшего pipeline; при наличии нескольких SoA с разной ориентацией — выбирать с visits в колонках, остальные помечать `orientationConflict=true`. Логика детектирования и transpose — следующий коммит.

### Спринт 1 SoA footnotes (commit 7/7): deprecation legacy endpoints + summary

`apps/api/src/routers/processing.ts`:
- Над процедурами `updateSoaCellFootnoteRefs` и `updateSoaTableFootnotes` поставлены JSDoc-комментарии `@deprecated` с указанием замены (`soaFootnote.linkAnchor`/`unlinkAnchor` и `soaFootnote.create`/`update`/`delete`) и target-спринта удаления (Sprint 5).
- При каждом вызове старых endpoints пишется `logger.warn("[deprecated] ...")` с `tenantId` + ID ресурса — поможет в логах подсчитать оставшихся клиентов до удаления.

**Sprint 1 SoA footnotes — итог по 7 коммитам:**

| # | SHA | Что |
|---|---|---|
| 1 | `3e4f78d` | DB-модели `SoaFootnote` + `SoaFootnoteAnchor`, два enum, миграция `20260502205347_add_soa_footnotes`. Legacy-поля помечены `@deprecated`. |
| 2 | `84a7a80` | Pure-функции `extractCellMarkers` / `extractFootnoteDefinitions` / `linkAnchorsToFootnotes` в doc-parser. 36 unit-тестов. |
| 3 | `e39ea03` | `parseHtmlTableWithSpans` сохраняет `rawHtml` ячеек, `expandGridFromHtmlRows` строит `rawHtmlGrid`, `buildSoaResult` извлекает маркеры и анкоры, `persistSoaTables` пишет в нормализованные таблицы + sync legacy. 7 integration-тестов. |
| 4 | `6bf2ca2` | Сервис + tRPC router `soaFootnote`, расширенный `getSoaData`, переписанные legacy shims. 13 service-тестов. |
| 5 | `9a21da5` | Полный редизайн `FootnotesPanel` в rule-admin: реальные маркеры, bind cell/row/col, бейджи anchors. |
| 6 | `ca71bf5` | Read-only список сносок в apps/web SoaTab под каждой SOA-таблицей. |
| 7 | (this) | `@deprecated` JSDoc + `logger.warn` на legacy endpoints для удаления в Sprint 5. |

Что покрыто конкретно по протоколам пользователя (см. примеры «4.2.2.1 Блок-схема клинического исследования»):
- `Прием препарата²` — маркер `2` извлечён из rawHtml ячейки названия процедуры → `targetType='row'`, `rowIndex` соответствующей процедуры.
- `X¹` в ячейке «Регистрация НЯ → Скрининг» — маркер `1` → `targetType='cell'`, cellId соответствующей ячейки.
- Массовые `X*` в столбцах НВ/ДЗ — каждый получает свой `cell` anchor.
- Блок «Примечание:» с разделителями em-dash (`* — по показаниям`, `1 — до введения...`) парсится `extractFootnoteDefinitions`. Многобуквенный глоссарий (`ТЗ – телефонный звонок`, `MFI-20 (...) - ...`) автоматически отсеивается по whitelist маркеров.

Что не покрыто этим спринтом:
- Графические маркеры (горизонтальные стрелки между ячейками для «Прием препарата²» / «Заполнение Дневника пациентом») — отдельный Sprint 3 «Drawing-derived cells» с XML-парсингом DOCX через JSZip + fast-xml-parser.
- Continuation-таблицы (длинная SOA, разбитая на 2 части с повторённой шапкой) — отдельный Sprint «merge SoA continuations». Сейчас детектор их видит как две независимые SOA.
- Удаление legacy полей и endpoints — Sprint 5 после унификации UI rule-admin/web в shared-компонент.

Все 171 тест api и 132 теста doc-parser зелёные. Полный typecheck на 17 workspace зелёный. Lint без новых errors.

### Спринт 1 SoA footnotes (commit 6/7): read-only список сносок в apps/web SoaTab

`apps/web/src/app/(app)/documents/[versionId]/page.tsx` — медицинский писатель в основном UI впервые видит сноски, привязанные к каждой SOA-таблице.

- Новый компонент `SoaFootnotesReadOnly` (типы `SoaFootnoteWithAnchors` и `SoaFootnoteAnchor` локально) рендерит блок «Сноски (N)» под существующим Score Info. Каждая сноска: маркер (`*`, `1`, `†`…) + текст + бейджи `N ячеек / N строк / N столбцов`. Если выбрана ячейка — соответствующие сноски подсвечиваются `bg-brand-50` (брендовая полоса).
- Источник данных — `processing.getSoaData` (расширен в Коммите 4 чтобы возвращать `soaFootnotes[].anchors[]`).
- В шапке блока подсказка `Info` иконкой: «Редактирование в rule-admin» — медицинский писатель в apps/web имеет read-only доступ; полный CRUD — на стороне `apps/rule-admin/.../soa-viewer/`.
- Если у таблицы 0 сносок — блок не отображается совсем (без шумного «не обнаружено»).

### Спринт 1 SoA footnotes (commit 5/7): редизайн FootnotesPanel в rule-admin

`apps/rule-admin/src/app/(app)/golden-dataset/[id]/soa-viewer/SoaViewer.tsx` — переписан целиком (~830 строк). Главные изменения:

- Типы `SoaFootnote`, `SoaFootnoteAnchor`, `FootnoteMutations` добавлены, `SoaTable` расширен полем `soaFootnotes: SoaFootnote[]` (с массивом `anchors`). Старые поля `SoaTable.footnotes: string[]` и `SoaCell.footnoteRefs: number[]` помечены `@deprecated` в коде, но сохранены в типах для отображения суперскриптов в ячейках (рендерим реальные маркеры через `markerOrder → marker` карту).
- `FootnotesPanel` переработан с нуля. Каждая строка сноски (`FootnoteRow`) показывает реальный маркер (`*`, `†`, `1`, `2`…), inline-редактирование marker и text через `soaFootnote.update` мутацию, кнопку удаления (с confirm) через `soaFootnote.delete`. Бейджи `Nc / Nr / Ncol` показывают сколько у сноски ячеек/строк/столбцов anchors.
- При выбранной ячейке у каждой сноски появляется toggle-кнопка «Bind cell» — нажатие вызывает `soaFootnote.linkAnchor` (если ещё не привязана) или `soaFootnote.unlinkAnchor` (если есть anchor для этой ячейки). Подсветка `highlightedFootnoteIds` рассчитывается через фильтр `anchors.cellId === selectedCell.cellId`.
- Новые режимы привязки «Строка» и «Столбец»: dropdown со списком процедур / визитов + dropdown со списком сносок → кнопка «Привязать» вызывает `linkAnchor` с `targetType='row'` / `'col'`. Этого не было — раньше можно было привязывать только к ячейкам.
- Inline-форма «Создать сноску» (marker + text) внизу панели → `soaFootnote.create` с `source='manual'`.
- Удалены старые мутации `updateSoaCellFootnoteRefs` и `updateSoaTableFootnotes` из UI — они остаются в API как legacy shim для backward compat (Коммит 4).

E2E-тест для нового UI не добавлен в этом коммите (отдельный проход с Playwright Codegen, см. memory `feedback_e2e_workflow.md`). TypeScript + lint зелёные на всём монорепо.

### Спринт 1 SoA footnotes (commit 4/7): tRPC router + service + расширенный getSoaData

Новый домен `soaFootnote` в API:
- `apps/api/src/services/soa-footnote.service.ts` (новый) — singleton с методами `listForTable`, `create`, `update`, `delete`, `linkAnchor`, `unlinkAnchor`. Каждый метод проходит `requireTenantResource()` через цепочку `soaTable.docVersion.document.study.tenantId`. `linkAnchor` валидирует что `cellId` принадлежит тому же `SoaTable` (защита от cross-table mixing). Внутри сервиса — sync legacy `SoaTable.footnotes` и `SoaCell.footnoteRefs` после каждой мутации, чтобы старый UI продолжал видеть актуальные данные.
- `apps/api/src/routers/soa-footnote.ts` (новый) — тонкий tRPC router. Все procedures `protectedProcedure`, входы валидируются через `zod`. `linkAnchor` использует `z.discriminatedUnion("type", ...)` для типизированного target (cell/row/col).
- Регистрация: `appRouter.soaFootnote = soaFootnoteRouter` в `apps/api/src/routers/index.ts`.

`apps/api/src/services/processing.service.ts`:
- `getSoaData` расширен — теперь `include` включает `soaFootnotes: { orderBy: markerOrder asc, include: anchors }`. Frontend получает нормализованные сноски с массивом anchors напрямую.
- `updateSoaCellFootnoteRefs` (legacy `@deprecated`) переписан как **shim**: внутри транзакции удаляет существующие cell-anchors данной ячейки и создаёт новые `SoaFootnoteAnchor` рядом с обновлением legacy `SoaCell.footnoteRefs`. Старый клиент работает, новые данные пишутся куда нужно.
- `updateSoaTableFootnotes` (legacy `@deprecated`) переписан: внутри транзакции `deleteMany SoaFootnote where soaTableId` (cascade удаляет анкоры), затем `createMany` с `marker = String(idx+1)`, `markerOrder = idx`, `source = 'manual'`. Параллельно обнуляет `SoaCell.footnoteRefs` потому что старые `markerOrder` ссылки больше невалидны.

Тесты `apps/api/src/__tests__/integration/soa-footnote-service.test.ts` (новый) — 13 кейсов: create/list, cross-tenant FORBIDDEN, дубликат маркера → CONFLICT, linkAnchor cell/row/col, cellId из чужого SoaTable → DomainError, footnote чужого тенанта → NOT_FOUND, sync legacy footnoteRefs, cascade-delete anchors, legacy shim записывает анкоры в нормализованную таблицу. Все 171 тест api зелёные.

### Спринт 1 SoA footnotes (commit 3/7): wiring детектора, persist в нормализованные таблицы

`packages/shared/src/soa-detection-core.ts` — внутренняя ревизия детектора SoA, чтобы впервые реально извлекать сноски и привязки к ним из таблицы и сохранять их в `SoaFootnote` + `SoaFootnoteAnchor`.

- Добавлено поле `rawHtml` в `HtmlCell`, поля `rawHtmlGrid` и `nextBlockHtml` в `TableCandidate`. `parseHtmlTableWithSpans` теперь через group-capture сохраняет содержимое каждой ячейки между `<td>...</td>`, чтобы маркеры `<sup>` и Unicode-надстрочные не терялись на этапе `stripHtmlTags`.
- `expandGridFromHtmlRows` параллельно строит `rawHtmlGrid` — заполнение rowspan/colspan повторяет rawHtml исходной ячейки **только** для верхне-левого слота, остальные слоты пустые. Это критично, иначе маркеры дублировались бы для каждой объединённой ячейки.
- `collectTableCandidates` ищет следующий блок `paragraph`/`list` в той же section и сохраняет его HTML — это будущий блок «Примечание:» под таблицей с определениями сносок.
- `buildSoaResult` использует `extractCellMarkers`/`extractFootnoteDefinitions`/`linkAnchorsToFootnotes` (Коммит 2): извлекает маркеры из шапки → `targetType='col'`, из первого столбца → `targetType='row'`, из data-cells → `targetType='cell'`. `cleanText` идёт в `rawValue`, `procedures[i]`, `visits[c]` — таким образом ячейка `X<sup>1</sup>` нормализуется в `rawValue='X'` + якорь сноски `1` на эту ячейку.
- `persistSoaTables` в той же транзакции (`timeout: 60_000`) после `createMany(cells)` строит `cellIdMap` через `findMany`, делает `tx.soaFootnote.createMany`, затем `tx.soaFootnoteAnchor.createMany` с резолвом `cellId` для cell-анкоров. Параллельно заполняет legacy `SoaTable.footnotes` (массив текстов) и `SoaCell.footnoteRefs` (массив `markerOrder` всех cell-анкоров данной ячейки) для backward-compat.
- `packages/shared/package.json` — добавлена зависимость `@clinscriptum/doc-parser`.

Интеграционный тест `apps/api/src/__tests__/integration/soa-footnotes.test.ts` (новый) — 7 кейсов: создаёт DocumentVersion + Section + ContentBlock с тестовой SoA-таблицей и блоком «Примечание», запускает `detectSoaForVersion`, проверяет создание `SoaFootnote`/`SoaFootnoteAnchor` правильных типов (cell/col), резолв `cellId`, очистку маркеров из `rawValue`/visit names, синк legacy-полей, cascade-delete. Все 158 тестов api-workspace зелёные.

### Спринт 1 SoA footnotes (commit 2/7): inline-маркеры и определения сносок — pure-функции

`packages/doc-parser/src/cell-markers.ts` (новый модуль). Три pure-функции, без зависимости от mammoth/Prisma — чисто работают со строками HTML:

- **`extractCellMarkers(rawCellHtml)`** — возвращает `{cleanText, markers[]}`. Извлекает маркеры из:
  - `<sup>...</sup>` (любой токен внутри, поддержка через запятую `<sup>1,2</sup>`);
  - Unicode-надстрочных `¹²³⁰⁴⁵⁶⁷⁸⁹` (карта U+00B9 / U+00B2 / U+00B3 + U+2070..U+2079);
  - символов `*†‡§¶#` в любом месте текста;
  - чисел в скобках `(1)..(N)` где N≤30;
  - HTML-entities (`&dagger;` → `†` и т.п.);
  - стандалонной цифры в ячейке (`1`, `1.`) — вся ячейка трактуется как footnote-only.
  Цифры в обычном тексте без контекста (`Day 1`) маркером **не считаются** — это ключевая эвристика.

- **`extractFootnoteDefinitions(htmlBlockAfterTable)`** — парсит блок «Примечание:» под таблицей. Поддержка разделителей `):.\-–—\s+` (включая en-dash `–` U+2013 и em-dash `—` U+2014, что критично для русских протоколов: `* — по показаниям`, `1 – до введения...`). Whitelist маркеров — только `*†‡§¶#` или `1..30`; глоссарий аббревиатур (`ТЗ – телефонный звонок`, `MFI-20 (...) - ...`) автоматически отсеивается. Дубликаты маркера в одном блоке — берётся первый, второй пропускается с `console.warn`.

- **`linkAnchorsToFootnotes(pendingAnchors, definitions)`** — резолвит маркеры якорей в итоговые `SoaFootnote`-объекты. Определения идут первыми (preserve order), маркеры якорей без определения добавляются потом как «orphan» c `text=""`.

`packages/doc-parser/src/index.ts` — re-export новых функций и типов.

Тесты: `packages/doc-parser/src/__tests__/cell-markers.test.ts` — 36 тестов (19 для extractCellMarkers, 12 для extractFootnoteDefinitions, 5 для linkAnchorsToFootnotes), включая Unicode, HTML-entities, дубликаты, em-dash, фильтр глоссария. Все 132 теста doc-parser зелёные.

### Sprint 5.2 + 5.3 — few-shot inject в LLM Check + eval-метрика

`apps/workers/src/handlers/classify-sections.ts`, `apps/workers/src/handlers/run-evaluation.ts`, `apps/workers/src/handlers/__tests__/{classify-sections,run-evaluation}.test.ts`.

**5.2 — Few-shot inject в LLM Check.** Перед каждым batch LLM Check загружаются активные `ClassificationFewShot` tenant'а (top-`FEWSHOT_MAX_PER_PROMPT=100` по `createdAt desc`) и добавляются в систем-промпт блоком «ДОПОЛНИТЕЛЬНЫЕ ПРИМЕРЫ ОТ ЭКСПЕРТА (имеют приоритет)»:

```
1. "Препарат сравнения" (путь: 5. Изучаемый препарат) → ip.comparator — отдельная subzone
2. "Шкалы и опросники" → appendix.scales_and_questionnaires — в приложениях
...
```

Если store пуст — блок пустой, поведение идентично pre-Sprint 5. Hardcoded few-shot из seed-prompts.ts оставлены как baseline.

**5.3 — Eval-метрика few-shot observability.** `run-evaluation` handler после расчёта `metrics` загружает active few-shots tenant'а и добавляет в `metrics.fewShots`:
```json
{
  "activeCount": 14,
  "zonesCovered": 9,
  "byZone": { "ip.comparator": 3, "procedures.lifestyle": 2, ... }
}
```
Помогает понять покрытие zones примерами при interpretation baseline diff'ов.

### Sprint 5.1 + 5.4 — хранение эталонных примеров классификации + UI

`packages/db/prisma/schema.prisma` (model `ClassificationFewShot` + миграция `20260503000000_add_classification_few_shots`), `apps/api/src/services/few-shot.service.ts`, `apps/api/src/routers/few-shot.ts`, `apps/rule-admin/src/app/(app)/few-shots/page.tsx`.

**5.1 — Storage:**
- Новая Prisma model `ClassificationFewShot` (tenant-isolated): `title`, `parentPath?`, `contentPreview?`, `standardSection`, `reason?`, `isActive`, `sourceSectionId?`, `createdById`. Indexes на `(tenant_id, is_active)` и `(tenant_id, standard_section)` для быстрого top-K lookup.
- `fewShotService` с CRUD методами: `create`, `list` (с курсорной пагинацией), `get` (tenant-isolation guard), `update`, `delete`, `listActive` (для будущего LLM Check inject в Sprint 5.2).
- tRPC router `fewShot` с endpoints `list/get/create/update/delete` под `qualityProcedure` (требует rule_admin/rule_approver/tenant_admin).

**5.4 — UI `/few-shots`:**
- Страница в rule-admin (`/few-shots`) — CRUD управление примерами. Фильтры по zone и активности.
- Inline-редактор в модалке: title, parentPath, standardSection (group-select по zone/subzone), reason, contentPreview (≤500 chars), isActive flag.
- Список с breadcrumb (parentPath), zone в моноширинном шрифте, причиной курсивом, превью контента в две строки.
- Toggle активности per-item кнопкой (без открытия редактора). Hard-delete с подтверждением.

Sprint 5.2 (подмешивание few-shot в LLM Check) и 5.3 (eval-метрика) пойдут отдельным PR-B после merge.

## 2026-05-02

### Спринт 1 SoA footnotes (commit 1/7): нормализованная модель сносок — schema + migration

Заменяем грубое хранение SoA-сносок (`SoaTable.footnotes: Json string[]` + `SoaCell.footnoteRefs: Json number[]`) на нормализованную M:N-модель с привязкой к ячейке/строке/столбцу. Старые поля помечены `/// @deprecated removed in Sprint 5` и пока остаются для backward-compat shim.

`packages/db/prisma/schema.prisma`:
- Добавлены два enum: `SoaFootnoteSource` (`detected | manual`), `SoaFootnoteAnchorTarget` (`cell | row | col`).
- Добавлена модель `SoaFootnote` — текст сноски с произвольным маркером (`*`, `†`, `1`, `2`, `2a`…) и порядковым номером для устойчивой сортировки. `@@unique([soaTableId, marker])` защищает от дублей.
- Добавлена модель `SoaFootnoteAnchor` — якорь сноски на одну из трёх целей: `cell` (через FK `cellId`), `row` (по `rowIndex`), `col` (по `colIndex`). Composite `@@unique([footnoteId, targetType, cellId, rowIndex, colIndex])` + индексы по `footnoteId`, `(soaTableId, targetType)`, `cellId`. Все FK с `ON DELETE CASCADE`.
- Обратные relations добавлены в `SoaTable.soaFootnotes`/`footnoteAnchors` и `SoaCell.footnoteAnchors`.

Миграция: `packages/db/prisma/migrations/20260502205347_add_soa_footnotes/` (2 enum, 2 таблицы, 5 индексов, 4 FK).

Дальнейшие коммиты спринта (см. `~/.claude/plans/spicy-tinkering-pearl.md`): извлечение inline-маркеров из HTML mammoth, persist в новые таблицы, API endpoints, переработка `FootnotesPanel` в rule-admin, read-only список в apps/web, deprecation legacy.

### Fix taxonomy: legacy zone-keys заменены везде в production коде

Прошёл по всему коду и заменил **старые** zone keys на актуальные:
- `ip.preclinical_data` → `ip.preclinical_clinical_data` (расширена в PR-9)
- `population.contraception_requirements` → `procedures.contraception_requirements` (перенесена в PR-9)
- `procedures.schedule_of_assessments` / `schedule_of_assessments` → `design.visit_schedule` / `visit_schedule` (слита в PR-12)

Затронуло hardcoded references в `EXCLUDED_SECTION_PREFIXES` (api + shared), `DEFAULT_PROTOCOL_SECTIONS` (section-classifier — обновлён canonical key + расширены regex-patterns русскими «регламент клинического исследования»/«блок-схема»), `impact-analyzer`, `generate-icf` (SECTION_TO_PROTOCOL_MAP), `intra-doc-audit` (ZONE_AFFINITY_MAP), `rule-admin study-settings page` (KNOWN_ZONES + DEFAULT_AFFINITY_PAIRS), `web audit page` label-map.

### Расширение few-shot примеров в `section_classify:llm_check`

`packages/db/src/seed-prompts.ts`. Добавлены 4 новых примера для исторически путаемых zones:
- **#11 ip.description** — «Описание препарата / Состав / Лекарственная форма» (subzone vs parent ip)
- **#12 design.blinding_and_unblinding** — «Вскрытие кода / Раскрытие кода рандомизации»
- **#13 population.demographics_and_baseline** — «Антропометрические и демографические данные» (baseline, не procedures.vital_signs)
- **#14 appendix.scales_and_questionnaires** — «Шкалы и опросники» в приложениях

Tenant-admin может перезалить промпты через `npm run db:seed` (RuleSet section_classification_qa, version 1, deleteMany + create) или в rule-admin UI.

### Rule-admin: quick-fix + jump-to-row в Diff overlay классификации

`apps/rule-admin/.../ClassificationTreeViewer.tsx`. На странице Эталонные наборы → этап «Классификация» → панель Diff с эталоном (открывается по кнопке) каждая строка теперь имеет:

- **Inline-select** с zone-options из taxonomy (default = expected zone, fallback = текущая actual). Кнопка «Применить» вызывает `updateSectionClassification` мутацию (validated). После успеха `getVersion` инвалидируется → diffEntries пересчитывается → строка автоматически исчезает из overlay, если расхождение устранено.
- **Кнопка перехода к строке** (icon `CornerDownRight`): сбрасывает фильтры, раскрывает collapsed parents, выставляет `activeSectionId` → useEffect делает `scrollIntoView`. Фокус возвращается на tree-контейнер для keyboard nav.

Detail-rows (ожидалось/получено) разнесены на отдельные строки для читаемости. Quick-fix отключается (`disabled`) для diff-entry без matched section в дереве (например `missing` без actual sections в БД).

### PR-B спринта 2: иерархия + окно соседей + few-shot

Финальный PR спринта качества классификации — все 3 задачи плана 2.1/2.2/2.3.

- **Task 2.1 — иерархия zone/subzone в classifier.** `SectionClassifier.classify()` принимает optional `parentZone?` — внутри scoring loop subzone-кандидаты с matched parent получают bonus +0.05, с mismatched parent — penalty -0.1, top-level zones не затрагиваются. Новый метод `classifyHierarchical(sections)` итерирует sections в document-order, поддерживает stack `{level, zone}` для определения document-parent-zone каждой секции. `apps/workers/src/handlers/classify-sections.ts` deterministic step переключён с map-classify на `classifyHierarchical()`. +6 тестов в `__tests__/section-classifier.test.ts`.
- **Task 2.2 — окно ±3 соседей в LLM Check user-message.** Раньше передавался `topLevelOutline` — все top-level заголовки документа. Теперь `buildEnrichedOutline(sectionId)` показывает 3 секции до и после текущей, с маркировкой текущей `→` и уже присвоенными zones в `[brackets]`. Это даёт LLM sequence-context — соседи в safety-секции → текущая вероятнее тоже в safety.
- **Task 2.3 — few-shot примеры в `seed-prompts.ts`.** В `section_classify:llm_check` промпт добавлен блок «ПРИМЕРЫ КЛАССИФИКАЦИИ» — 10 hand-picked пар «заголовок → зона + причина», фокус на путаемые границы из baseline diff: `visit_schedule` после merge (регламент/блок-схема/SoA), `ip.comparator`, `procedures.lifestyle`, `procedures.contraception_requirements`, `preclinical_clinical_data`, `inclusion` под parent `population`.

**Baseline после спринта 2:** `docs/baselines/after-spr2-no-qa-2026-05-02.json` — f1=0.675 vs f1=0.661 после спринта 1 (+1.4%). Прирост скромнее ожидаемого из-за устаревшего ground truth (эксперт размечал до новых subzones и иерархии — многие "extra" actual теперь точнее expected). Re-разметка golden samples в следующем спринте даст ещё +5-10% на том же коде.

Verified: 4 sample reprocess'нулись чисто (все `parsed`), 824 sections classified (186 deterministic + 636 llm_check + 2 unclassified). Dev DB цела после `npm run test` благодаря `apps/api/.env.test` и safety guard.

### PR-A спринта 2: side-fixes (SOA timeout + isolated test-DB)

Технический PR перед началом основной работы спринта 2 — устраняет 2 known-блокера для безопасного reprocess golden samples и автономной test-инфры.

- **SOA Prisma transaction timeout** (`packages/shared/src/soa-detection-core.ts:580-637`). На больших матрицах (200+ cells) per-cell `tx.soaCell.create` в loop упирался в дефолтный 5s `$transaction` timeout — STP-08-25 reprocess стабильно падал с `Transaction not found, refers to an old closed transaction`. Фикс: bulk-вставка через `tx.soaCell.createMany` (одна SQL-команда вместо N) + явный `{ timeout: 60_000, maxWait: 10_000 }` как defense-in-depth.
- **Изолированная test-DB.** Прежде integration tests из `apps/api/src/__tests__/integration/` запускались на dev DB `clinscriptum3` через общий `DATABASE_URL` — `cleanupTestData()` стирал все user-данные. Решение:
  - Создана отдельная DB `clinscriptum3_test` (миграции применены).
  - `apps/api/.env.test` (committed): `DATABASE_URL=postgresql://...clinscriptum3_test`, `JWT_SECRET=test-secret-do-not-use-in-prod`, `NODE_ENV=test`.
  - `apps/api/vitest.setup.ts` (new): minimal inline-loader `.env.test` (без зависимости от `dotenv`), не перезаписывает уже-выставленные env-vars (CI workflow получает свой `DATABASE_URL=clinscriptum_test` без конфликта).
  - `apps/api/vitest.config.ts`: `setupFiles: [vitest.setup.ts]`.
  - Документация в `apps/api/CLAUDE.md` — first-time setup инструкция.
  - Safety guard `assertSafeTestDatabase()` (из hotfix #12) остаётся как defense-in-depth.

Verified: `npm test --workspace=@clinscriptum/api` → 151/151 passed на test-DB; dev DB `clinscriptum3` неприкосновенна (2 tenants, 4 golden samples сохранены).

## 2026-05-02

### Hotfix: защита cleanupTestData + merge SoA → visit_schedule

Два связанных фикса по результатам инцидента data-loss и анализа baseline спринта качества классификации.

- **Safety guard в `cleanupTestData()`** (`apps/api/src/__tests__/integration/helpers.ts`). Функция выполняет `TRUNCATE TABLE x CASCADE` для всех таблиц схемы `public`. Тесты используют общий `DATABASE_URL` (нет отдельной test-DB через `.env.test`) — каждый запуск `npm test` на dev стирал user-данные. Добавлен `assertSafeTestDatabase()` который требует, чтобы `DATABASE_URL` содержал `_test` в имени БД ИЛИ выставлен `ALLOW_DESTRUCTIVE_TEST_CLEANUP=1`. На dev (`clinscriptum3`) тесты теперь упадут с понятной ошибкой вместо wipe. На CI (`clinscriptum_test`, `.github/workflows/ci.yml:17,67`) guard пропускает по pattern. Долгосрочный TODO — отдельная dev test-DB + `.env.test` + override в `turbo.json`.
- **Merge `procedures.schedule_of_assessments` → `design.visit_schedule`** (`taxonomy.yaml` + `apps/workers/scripts/migrate-taxonomy-keys.ts`). Pending decision из плана и memory зафиксирован: эти зоны слишком сильно пересекаются на реальных протоколах. Объединены в `design.visit_schedule` (title `«График визитов / процедур / SoA / расписание»`), все patterns/require_patterns/not_keywords из обеих зон объединены. В migration script добавлен mapping `procedures.schedule_of_assessments → design.visit_schedule` + bug fix в `countExpectedResultsRefs`: JSON может сериализоваться с пробелом после `:` или без — теперь проверяются оба варианта.

### Phase 1 spr.1 fact-extraction roadmap — алгоритмические улучшения без LLM

Первая фаза реворка этапа извлечения фактов (см. план `C:\Users\0\.claude\plans\dreamy-sauteeing-sutton.md`). Фокус — fundamental fixes без изменений LLM-промптов.

- **morphology module (`packages/rules-engine/src/morphology.ts`)** — лёгкий стеммер для русского и английского без нативных зависимостей. API: `stem(token, lang)`, `tokenize(text)`, `stemPhrase(text)`, `expandCyrillicEndings(stem)`, `stemEquals(a, b)`. RU-список суффиксов покрывает основные нормальные/адъективные/инфинитивные окончания, исключая past-tense verb endings (overlap с noun stems типа "протокола"). EN — Porter-style suffix stripping включая `-ies/-ied` для согласованного стемминга `studies/studied/study`. 29 тестов на флексионные пары. Используется в Phase 1.2+ для canonicalize и в Phase 3 для anchor-retrieval.
- **canonicalize module (`packages/rules-engine/src/canonicalize.ts`)** — типизированная нормализация значений фактов. Per-key handlers: `sample_size` → integer, `study_phase` → Roman→Arabic ("III"→"3", "II/III"→"2/3"), `study_duration` → нормализованные единицы (нед/wk/weeks→weeks, мес→months), `protocol_number` → uppercase, текстовые поля → stem-нормализованные. Это основа voting'а в `aggregateByCanonical`.
- **`aggregateByCanonical(facts)` + voting** заменяет `deduplicateFacts`: группирует raw matches по `(factKey, canonical)`, агрегирует sources, синопсис weight 2x, confidence = `min(0.95, 0.6 + 0.1·weighted_n_sources)`. `extract()`/`extractFromSections()` теперь возвращают `AggregatedFact[]` с полями `canonical`, `confidence`, `sources`, `sourceCount`. Лёгкий `extractRaw()` доступен как low-level API. Удалён `if (!rule.multipleValues) break` — все вхождения собираются для арбитража downstream. Тест `returns only first match for single-value rules` обновлён — теперь два разных протокол-номера сохраняются как два aggregated facts (LLM QA или contradiction-detector выбирает между ними), а не молча отбрасываются.
- **`detectContradictions`** теперь сравнивает canonical-формы вместо raw lowercase + whitespace normalization. "30 пациентов" / "N=30" / "30 patients" больше не дают ложноположительных контрадикций.
- 19 новых тестов для canonicalize + 4 теста на voting/order в fact-extractor. Все 258 тестов rules-engine зелёные.
- **Сохранение списочной структуры (`packages/shared/src/fact-extraction-core.ts`)** — новая утиль `serializeContentBlocks(blocks)` префиксует list-блоки `"- "` и обрамляет таблицы blank-line'ами при склейке. Ранее `contentBlocks.map(b => b.content).join("\n")` терял различие между параграфом и bullet-пунктом, и regex'ы для критериев/эндпойнтов могли захватить только первую строку. Теперь та же утиль используется в обоих местах склейки (`buildExtractableSections` для LLM check и `runDeterministic` для regex).
- **Multi-line bullet capture** в `DEFAULT_FACT_RULES` для `primary_endpoint`, `secondary_endpoint`, `inclusion_criteria`, `exclusion_criteria`: capture-группа расширена с `[^\n]+` до `[^\n]+(?:\n-\s+[^\n]+)*` — после первой строки захватываются все следующие строки, начинающиеся с `"- "`. Single-line ввод работает по-прежнему. 2 новых теста на multi-line lists.
- **`appendix` снят из `EXCLUDED_SECTION_PREFIXES`** (`packages/shared/src/fact-extraction-core.ts:16`). В клинических протоколах appendices обычно содержат расписание визитов (SoA), дозировочные таблицы, лабораторные пороги — отбрасывание этой секции на уровне deterministic + LLM check лишало нас существенного recall. `overview`/`admin`/`ip.preclinical_data` остались — это boilerplate без extractable фактов. Затрагивает также fallback `GLOBAL_DEFAULT_PREFIXES` в `apps/api/src/services/study.service.ts:6` — для tenants без custom-config.
- **Расширение модели `Fact`** — миграция `20260502000000_add_fact_canonical_value`. Новые колонки: `canonical_value` (TEXT), `standard_section_code` (TEXT), `source_count` (INTEGER NOT NULL DEFAULT 1). `canonicalValue` хранит нормализованную форму из `canonicalize(factKey, value)`, по нему сравнивается равенство в voting и contradiction detection; `standardSectionCode` декуплирован от section-таксономии (свободная строка) — устойчив к параллельной работе по классификации секций; `sourceCount` отражает результат `aggregateByCanonical`. Все nullable / default — обратно-совместимо для старых строк.
- **`runDeterministic` пишет canonical/standardSection/sourceCount** (`packages/shared/src/fact-extraction-core.ts`). Раньше Fact-строки создавались с `confidence: 1.0` независимо от `aggregateByCanonical`-результата; теперь пишется реальный `confidence` из агрегата (зависит от количества и типа источников), а также `canonicalValue` лучшего варианта, суммарный `sourceCount` по всем canonical-группам одного `factKey` и `standardSectionCode` секции лучшего источника. `variants` разворачиваются по сорсам внутри каждой агрегированной группы, чтобы downstream пользователь видел все источники.

### Phase 0 spr.0 fact-extraction roadmap — observability infrastructure

Базовая инфраструктура для измерения качества извлечения фактов до начала любых алгоритмических изменений Phase 2+.

- **`RequestContext` расширен** (`packages/shared/src/context.ts`) полями `processingRunId?`, `docVersionId?`, `sectionId?` — при логировании эти поля автоматически попадают в JSON-вывод через `logger.ts`, что облегчает корреляцию логов pipeline-запусков.
- **Per-factKey coverage metric** — миграция `20260502120000_add_fact_coverage_metrics`. Новые колонки: `evaluation_runs.fact_coverage` (DOUBLE PRECISION) и `evaluation_results.coverage_by_fact_key` (JSONB). Формат `coverage_by_fact_key`: `{ factKey: { expected, extracted, matched } }`.
- **`run-evaluation` handler** (`apps/workers/src/handlers/run-evaluation.ts`) считает `computeFactCoverage(expected, actual)` для stage `extraction` — сопоставляет ожидаемые и извлечённые `factKey` + lowercase value, возвращает `{ expected, extracted, matched }` per ключу. Записывает в `EvaluationResult.coverageByFactKey`. Aggregation по run: `factCoverage = matchedTotal / expectedTotal` пишется в `EvaluationRun.factCoverage`.
- **`recordExtractionMetric`** (`apps/workers/src/lib/metrics.ts`) — новая функция логирующая `fact_extraction_metric` с полями `phase` (`deterministic|llm_check|llm_qa`), `factKey?`, `sectionId?`, `parseError?`, `tokens?`, `durationMs?`, `matched?`. Точка вызова появится по мере wiring'а в Phase 3 (targeted LLM) и Phase 5 (calibration).

### Phase 2 spr.2 fact-extraction roadmap — table AST + section priors

Самый крупный недополученный recall — таблицы синопсиса со sponsor / sample_size / phase / drug — извлекались плохо, потому что парсер коллапсировал tableAst в строку `"h1 | h2\nv1 | v2"` и regex'ы не могли её разобрать.

- **`ContentBlock.tableAst` (Json)** — миграция `20260502130000_add_content_block_table_ast`. Парсер теперь сохраняет `{ headers, rows, footnotes }` для каждого `type='table'` блока. `parseDocx` (`packages/doc-parser/src/parser.ts:49-58`) добавляет `tableAst` к `ParsedContentBlock`. Worker handler `parse-document.ts:83-90` пишет это поле через `createMany`. `content` остаётся как fallback для legacy-читателей.
- **`extractFromTable` (`packages/rules-engine/src/table-extractor.ts`)** — новый extractor для двухстолбцовых key/value-таблиц. Поддерживает обе ориентации (заголовок слева/справа). Использует словарь `tableHeaderSynonyms.ts` (12 factKey × ru+en синонимы), normalising header'ы через `morphology.stemPhrase` чтобы «Спонсор:», «спонсор» и «sponsor» давали один и тот же matched key. Возвращает `ExtractedFact[]` совместимый с regex-выводом, что позволяет одной командой `aggregateByCanonical` склеить regex + table источники одного факта.
- **Интеграция в `runDeterministic`** (`packages/shared/src/fact-extraction-core.ts`) — теперь сначала собираются raw-matches из regex (`extractor.extractRaw`) и из всех `tableAst`-блоков всех eligible-секций, затем единая агрегация. Synopsis-источник работает как раньше — synonym из table-блока synopsis получает synonym-weight 2x в voting'е.
- **`fact_section_priors` RuleSet type** — миграция `20260502140000_add_fact_extraction_ruleset_types` (попутно зарегистрированы `fact_anchors` и `confidence_calibration` для Phase 3/5). `Rule.config = { factKey, expectedSections: string[] }`. В `runDeterministic` после raw-collection применяется `factMatchesSectionPriors`: если для `factKey` сконфигурирован prior — фильтруются только matches из секций с `standardSection` в whitelist'е (или его prefix-children). Если prior не задан — всё пропускается без изменений (default-permissive). Если секция не классифицирована — также пропускается (не штрафуем за пропуски section-classifier'а).
- **`renderTableMarkdown` (`packages/shared/src/utils/markdown.ts`)** — утиль рендера AST в pipe-Markdown с экранированием `|`. Готовится к подмешиванию в LLM-промпты Phase 4 (где table-блок надо подавать модели как разметку, а не CSV).
- **13 новых тестов** для tableHeaderSynonyms + extractRawFromTable + extractFromTable. Все 291 тестов rules-engine зелёные.

### Phase 3 spr.3 fact-extraction roadmap — anchor retrieval + targeted LLM

Уход от «discovery по всему документу» к таргетным узким вопросам по каждому ключу из реестра. Снижает токен-стоимость и parseErrors при росте recall.

- **`Bm25Index` (`packages/rules-engine/src/retrieval/bm25.ts`)** — чистый JS BM25 (~140 строк, без нативных зависимостей). Параметры по умолчанию k1=1.5, b=0.75. Использует `morphology.stemPhrase` + `tokenize` для препроцессинга (русские/английские словоформы collapse). API: `add(docId, text)`, `topK(query, k)`, `score(docId, queryTerms)`. 8 тестов на ранжирование, длину, морфологию, dedupe-by-id.
- **`fact_anchors` RuleSet seed (`packages/db/src/seed-fact-anchors.ts`)** — 12 anchor-rule'ов (по одному на factKey: `study_title`, `protocol_number`, `sponsor`, `study_phase`, `indication`, `study_drug`, `sample_size`, `study_duration`, `primary_endpoint`, `secondary_endpoint`, `inclusion_criteria`, `exclusion_criteria`). Конфиг каждого правила: `{ factKey, keywords: { ru[], en[] }, weight }`. Глобальный (tenantId=null). Запускается через `seedFactAnchors(prisma)` из `@clinscriptum/db`.
- **`runLlmCheckTargeted` (`packages/shared/src/fact-extraction-core.ts`)** — новая Level-2 функция. Алгоритм:
  1. Собирает extractable-секции, строит BM25-индекс.
  2. Для каждого `factKey` из реестра: query из anchor-keywords (ru+en) → BM25.topK(3) → 3 узких LLM-вызова "извлеки `<factKey>` или верни null" с `temperature` из task config (`fact_extraction_targeted`).
  3. Gap-fill второй проход: factKey'и, по которым ничего не нашлось, ретраются с T=0.3 на top-1 секции — стабильнее закрывает «есть/нет в тексте» дилемму.
  4. Все raw matches проходят `aggregateByCanonical`, мерджатся в Fact-строки (update existing если deterministic уже создал, иначе create новые).
- **Feature flag `LLM_CHECK_MODE`** — `targeted` переключает `runLlmCheck` на `runLlmCheckTargeted`, `broad` (default) сохраняет legacy-поведение для канареечного раскатывания.
- **Task `fact_extraction_targeted`** в `llm-config-resolver.ts` — `maxTokens=1024` (узкие ответы), `maxInputTokens=8000` (одна секция максимум), переопределяемо через env / DB tenant config.
- **`chunkWithOverlap` (`packages/shared/src/utils/chunking.ts`)** — sliding-window утиль (size=8000, overlap=1000 по умолчанию) с предпочтением break'а на whitespace в последних 10% окна. Готовится к подмешиванию в `runLlmCheckTargeted` для over-budget секций. 6 тестов.
- **35 новых тестов** (BM25 + chunking). Все 326 тестов rules-engine зелёные.

### Phase 4 spr.4 fact-extraction roadmap — LLM prompt quality

Устраняем хрупкость LLM-вызовов: жёсткая валидация, осознание неопределённости через self-consistency, фокусированный QA-контекст.

- **`parseLlmJson` + Zod (`packages/shared/src/utils/llm-json.ts`)** — стек-сканер балансированных скобок (`findJsonSpan`) заменяет greedy `[\s\S]*]`-regex, корректно обрабатывая JSON со вложенными `[`/`{` внутри `source_text`. Парсер возвращает `{ ok: true, data } | { ok: false, error }` с детализацией ZodError. Готовые схемы: `FactExtractionItemSchema`, `FactExtractionArraySchema`, `TargetedFactSchema`. Strip'ит `<think>` блоки и detect'ит refusal-паттерны (`не могу обсуждать`...).
- **`parseLlmJsonArray` использует `findJsonSpan`** — старый regex-based extractor в `runLlmCheck` теперь идёт через стек-сканер; падения на JSON со вложенными скобками внутри строк (характерно для `source_text` с цитатами эндпойнтов) ушли.
- **`runLlmCheckTargeted` валидирует через Zod** — каждая ответ-JSON-payload проходит `TargetedFactSchema`, в случае mismatch'а пишется warning с детализацией zod-ошибки в `processingRun.metadata`.
- **Self-consistency для critical keys** — для `study_drug`, `sample_size`, `primary_endpoint`, `study_phase` (override через env `LLM_FACT_CRITICAL_KEYS`): если single-shot confidence `< 0.7`, делаются 2 дополнительных вызова с `T=0.3`, majority по `canonicalize`. Confidence boostится на `0.1·(votes-1)`, capped в 0.95.
- **QA scope per-section** — `runLlmQa` теперь собирает `referencedSectionIds` из `variants[].sectionId` всех проверяемых фактов, и грузит в context только эти секции (вместо `docSnippet.slice(0, qaInputBudget)` по всему документу). Если ни один variant не имеет `sectionId` (legacy data) — fallback на whole-doc.
- **16 новых тестов** для llm-json (findJsonSpan + parseLlmJson). Все 347 тестов rules-engine зелёные.

### Phase 5 spr.5 fact-extraction roadmap — calibration + cross-source reconciliation

Замыкаем feedback loop: калиброванная confidence через изотонически-подобную формулу и публикация cross-source расхождений как первоклассных Findings.

- **`applyCalibration(rawConf, factKey, sectionType, nSources, coefs)`** в `packages/rules-engine/src/canonicalize.ts`. Формула `final = sigmoid(α·(raw-0.5) + β·prior(factKey,sectionType) + γ·log(1+max(0,n-1)))`. Дефолтные коэффициенты `α=1.0, β=0.3, γ=0.15`. `prior` хранится как `{ factKey: { sectionType: number } }` — будет калиброваться `scripts/calibrate-confidence.ts` против golden samples с использованием `confidence_calibration` RuleSet (тип уже зарегистрирован в Phase 2 миграции).
- **`brierScore(predicted, actual)`** — стандартная мера калибровки. 0 = идеально, 1 = противоположное. Будет использоваться в `EvaluationResult.confidenceMetrics` после wiring'а.
- **Cross-source reconciliation как Finding (`runDeterministic`)** — после агрегации проверяется каждый `factKey` с >1 canonical-группой; если множества canonical из synopsis-источников и body-источников расходятся, эмитится `Finding` с `type=intra_audit`, `issueType=synopsis_body_mismatch`, `issueFamily=fact_consistency`, `severity=medium`. `extraAttributes` содержит `synopsisCanonicals[]` и `bodyCanonicals[]` для UI-отображения. `sourceRef` — структурированный JSON для quick-fix workflow.
- **`runDeterministic` data-возврат** дополнен `synopsisBodyMismatch: <count>` для метрик и observability.
- **9 новых тестов** для applyCalibration + brierScore. Все 378 тестов rules-engine зелёные.

### Active learning + prompt-RuleSet — отложено в follow-up

Часть Phase 4 (перенос промптов в RuleSet, few-shot per standardSection, генератор `scripts/generate-few-shot.ts`) и часть Phase 5 (типизация `CorrectionRecommendation.recommendationType`, `scripts/calibrate-confidence.ts`, UI рекомендаций в rule-admin) требуют автономной разработки с UI-итерациями + golden-датасета. Пишутся отдельными PR-ами после baseline-замера на текущей версии.

## 2026-05-01

### PR-3 спринта качества классификации: Sprint 0 mitigation + UI fixes

Третий и финальный PR спринта. Закрывает 4 накопившиеся UX/инфра-задачи из `project_known_bugs.md` и плана.

- **task 0.1 (mitigation)** — `LLM QA TypeError: fetch failed` для DeepSeek-V32. Без полной диагностики, defensive-fix:
  - `MAX_SECTIONS_PER_BATCH` снижен с 25 до 10 — меньший payload снижает шанс connect/timeout failure на reasoning-модели.
  - Добавлен per-batch retry в QA-step: `QA_BATCH_RETRY_ATTEMPTS=2` с экспоненциальным backoff (5s × attempt). Раньше при первом fetch-failed batch уходил в parseError навсегда — все 8 batch'ей на типичном документе падали (см. логи 2026-05-01). Retry покрывает транзиентные сетевые проблемы.
  - Если после этого QA продолжает стабильно падать (одинаково 0 corrections на нескольких прогонах) — нужна полноценная диагностика (auth/endpoint/payload size). Пока не делаем — наблюдаем после реального применения.
- **UX bug fix — Studies Phase field reset.** В `apps/web/.../studies/page.tsx:11-21` `createMutation.onSuccess` сбрасывал все поля кроме `newPhase` (classic copy-paste bug). Добавлен `setNewPhase("");`. Теперь после создания нового study форма полностью очищается.
- **UI bug fix — Bulk «Подтвердить» при «Выделить все» в parsing-viewer.** В `apps/rule-admin/.../ParsingTreeViewer.tsx`:
  - `onSelectAll` использовал `visibleSections` (отфильтрованный/видимый список); при включённом фильтре или collapsed parents выделялось подмножество. Заменено на `rawSections` — все секции документа.
  - В `bulkUpdate` добавлен guard `if (selectedIds.size === 0) return;` — иначе mutation отправлял пустой массив и backend молча отрабатывал 0 строк, симптом «ничего не происходит».
- **UX — tooltip полного заголовка в parsing-viewer и classification-viewer.** Добавлен `title={section.title || "(без названия)"}` на truncated cell с заголовком секции. Решает проблему когда эксперт-разметчик не может прочитать длинный обрезанный заголовок без клика.

### PR-2 спринта качества классификации: handler classify-sections + точная eval-метрика

Второй из 3-х PR. Оптимизирует workers handler и приводит метрику evaluation к per-section уровню.

- **task 1.2 — LLM-промпты из БД с `{{catalog}}` плейсхолдером.** `classify-sections` теперь параллельно с правилами таксономии грузит `loadRulesForType(ctx.bundleId, "section_classification_qa")` и берёт оттуда `section_classify:llm_check` / `section_classify:qa` промпты по `name`. Шаблон содержит `{{catalog}}`, который заменяется на актуальный `buildZoneCatalog(rules)`. Fallback `DEFAULT_LLM_CHECK_PROMPT` / `DEFAULT_LLM_QA_PROMPT` — копии текущих захардкоженных версий с тем же плейсхолдером (safety net для свежих/тестовых инсталляций). `seed-prompts.ts`: оба промпта переписаны до уровня полных русскоязычных правил классификации (раньше там были stub'ы из 8 строк). Теперь rule-admin UI действительно влияет на runtime — раньше промпты в БД были мёртвым кодом.
- **task 1.3 — skip LLM Check при `confidence ≥ 0.85`.** Перед запуском `classifyOne` фильтруем по `HIGH_CONFIDENCE_SKIP=0.85`: LLM зовётся только на секции с `algoSection=null` или `algoConfidence<0.85`. Сократит ~60% LLM-запросов на типичном протоколе, где deterministic уже даёт высокую уверенность по очевидным `Synopsis`/`References`/etc. В response добавлены `verifiedByLlm` и `skippedHighConfidence` для метрик прогона.
- **task 1.5 — согласовать content snippet det/llm.** В deterministic step раньше передавался только `contentBlocks[0]?.content`; LLM steps использовали `join + slice(0, 2000)`. Теперь deterministic тоже получает `join + slice(0, 1000)`. Убирает рассинхрон уровней.
- **task 1.6 — per-section метрика в `run-evaluation.extractKeys` для classification.** Раньше `extractKeys` для `key='sections'` собирал ключ только по `standardSection` — set-уровень, дубли зон в одном документе считались как одна запись (3 секции `safety` = 1 ключ). Теперь для `key='sections'` если есть `title` — собираем пару `sections:<title.lowercase.trim>=<zone>`. Для других stages (extraction, contradiction_detection) логика сохранена. Существующие тесты `run-evaluation.test.ts` обновлены под новый shape (добавлен `title` в expected.sections).

### PR-1 спринта качества классификации: гейты в classifier + правки таксономии

Первый из 3-х PR по плану `docs/section-classification-quality-plan.md`. Восстанавливает FP-min логику таксономии и приводит ключи зон в порядок.

**`packages/rules-engine` — task 1.1: require_patterns / not_keywords gates + calibrated confidence**

- `SectionMappingRule` расширен полями `requirePatterns?`, `notKeywords?`, `type? ("zone" | "subzone")`, `parentZone?`. До этого поля были в `taxonomy.yaml`, но `rule-adapter.toSectionMappingRules` их не читал — вся логика жёстких гейтов и негативных штрафов из таксономии (явно прописанная для `synopsis`, `definitions`, `statistics` и др.) фактически не работала.
- `rule-adapter.toSectionMappingRules` теперь пробрасывает все 4 поля из `cfg`.
- `SectionClassifier.classify` переписан с **first-match** на **scoring**:
  - `requirePatterns` — hard gate: правило исключается из кандидатов, если ни один не matches title+content.
  - exact-match calibrated confidence: `0.6 + 0.3 * (matchLen/titleLen) + 0.05 * matchCount`, capped at `0.99`. Multi-pattern в одном правиле даёт бонус.
  - content-only match даёт фиксированную `0.65`.
  - `notKeywords` — штраф `−0.4` к финальной confidence, если совпадает в title или content.
  - выбирается кандидат с max score; tie-break по порядку правил.
- Тесты `__tests__/section-classifier.test.ts`: +13 кейсов на gate fail/pass, gate в content, штраф, проигрыш конкуренту при penalty, multi-match bonus, longest match wins, content < title confidence, Russian `\b` boundary с requirePatterns + notKeywords, calibration ranges. Существующие assert'ы на `confidence === 0.95` адаптированы на ranges (теперь это диапазон, не фиксированное значение).

**`taxonomy.yaml` — 4 правки (все из очереди в `project_known_bugs.md`)**

- `ip.preclinical_data` → `ip.preclinical_clinical_data`. Title: «Доклинические данные» → «Результаты значимых доклинических и клинических исследований». Расширены `require_patterns`/`patterns` чтобы покрывать и доклинику, и клинические данные (clinical experience/data/trials, результаты значимых клинических исследований). Раньше зона путалась с `efficacy_assessments` потому что узкое имя «доклинические» отсекало клинические results.
- `population.contraception_requirements` → `procedures.contraception_requirements`. Контрацепция/беременность — это операционные процедуры, а не критерий отбора population. Добавлен `not_keywords` для разграничения с `(in|ex)clusion criteria`.
- `procedures.lifestyle` (NEW): «Образ жизни / физическая активность» — диета, курение, алкоголь, физическая нагрузка во время исследования. Раньше эти секции попадали в parent `procedures` или ошибочно в `population.exclusion`. Жёсткий гейт + `not_keywords` против inclusion/exclusion и safety AE.
- `ip.comparator` (NEW): «Препарат сравнения» — `require_patterns: comparator | препарат сравнения | active control`. `not_keywords` против AE и prior comparator use.

**`apps/workers/scripts/migrate-taxonomy-keys.ts` (NEW)**

Скрипт миграции уже размеченных данных под изменённые ключи. Покрывает `sections.{standard_section, algo_section, llm_section, classification_comment}` + `golden_sample_stage_statuses.expected_results` (JSONB в части `sections[*].standardSection`). Dry-run по умолчанию, `--apply` выполняет в одной транзакции с post-apply verification (count старых ключей должен быть 0). В текущей dev-БД dry-run = 0 строк (старые ключи не использовались экспертами при разметке 4 golden samples), скрипт нужен для prod-миграции и будущих rename-операций.

После re-seed: 80 → 82 правила в `RuleSetVersion v1` (`+ip.comparator`, `+procedures.lifestyle`, перемещение `contraception_requirements`; rename — не меняет count).

### План улучшений классификации секций + первый baseline

Зафиксирован план комплексной доработки этапа `classify_sections` после аудита pipeline и инфраструктура для baseline-замеров на golden-наборах tenant Golden Set.

- **`docs/section-classification-quality-plan.md`** — план на 6 спринтов (≈13.5-17 дней, 19 коммитов): Спринт 0 — фикс flaky `TypeError: fetch failed` на `section_classify_qa`; Спринт 1 — восстановление `require_patterns`/`not_keywords` гейтов из таксономии (сейчас игнорируются), подгрузка LLM-промпта из БД (сейчас inline в handler), пропуск LLM Check на high-confidence секциях, calibrated confidence, согласование content snippet, per-section метрика в evaluation; Спринт 2 — иерархия zone/subzone, оконный контекст соседних решений, few-shot; Спринт 3 — batch LLM Check, robust JSON-парсер; Спринт 4 — heading detection без bold, singleton constraints, fuzzy zone resolve; Спринт 5 — correction-loop как источник few-shot. Каждая задача — затронутые файлы со строками, конкретные изменения, тесты, риски, оценка.
- **`apps/workers/scripts/run-baseline-evaluation.ts`** — скрипт через `npm run baseline --workspace=@clinscriptum/workers`: создаёт `EvaluationRun` с фиксацией активной `RuleSetVersion` + default LLM-config, ставит job `run_evaluation` в BullMQ-очередь `processing`, поллит до завершения (timeout 10 мин), сохраняет в `docs/baselines/{name}.json` git-коммит, ветку, конфиг, summary, per-sample результаты, delta. Опции `--name`, `--tenant`, `--stage`, `--output-dir`, `--compared-to`, `--dry-run`.
- **`docs/baselines/baseline-master-no-qa-2026-05-01.json`** — первый baseline на 4 размеченных golden-сэмплах (FNT-AS-III-2026, Тетра-AHAGGN-11/25, STP-08-25, VLT-015-II/2025): avgPrecision=0.969, avgRecall=0.930, avgF1=0.949, passRate=1.000. Зафиксирован git-коммит и снимок ruleSetVersion + llmConfig для воспроизводимости. Помечен `no-qa` — во всех 4 reprocess-прогонах llm_qa-стадия упала с `TypeError: fetch failed` (системная проблема DeepSeek-V32 endpoint, задача 0.1 в плане).
- **`apps/workers/package.json`** — добавлен npm-script `baseline`: `tsx --env-file=../../.env scripts/run-baseline-evaluation.ts`.
- **`.gitignore`** — добавлены `*.dump` и `backups/` (Postgres-дампы и snapshot-папка не попадают в репо). Прежде блокировались только `*.sql`.

## 2026-04-30

### Производительность: cursor-пагинация + индексы для findings

Раньше `getAuditFindings` и `getInterAuditFindings` отдавали **все** Finding-записи документа целиком — на протоколе с тысячами findings это блокировало event loop API и раздувало payload.

- **Миграция `20260430000000_add_finding_filter_indexes`**: 3 новых composite индекса на `Finding`:
  - `(docVersionId, severity)` — фильтр по тяжести
  - `(docVersionId, auditCategory)` — фильтр по категории
  - `(docVersionId, status)` — фильтр по статусу finding'а
  Без них даже фильтрованные запросы сканировали всю партицию по `docVersionId`.
- **`getAuditFindings` и `getInterAuditFindings`**: добавлены опциональные `take` (1..500) и `cursor` (UUID последнего id). Если ни один не передан — возвращает все findings (back-compat, UI не сломан). Если передан — cursor-based пагинация через `take + 1` фокус для определения `hasMore` и возврат `nextCursor`. `orderBy` дополнен `id: "asc"` для стабильной сортировки на ties.
- **Routers**: input расширен на `take`/`cursor` через Zod (`z.number().int().min(1).max(500).optional()`, `z.string().uuid().optional()`).
- **Тесты `audit.service.test.ts`** (+5 кейсов): без пагинации возвращаются все findings (back-compat), `take=N` с overflow → N findings + nextCursor, `take=N` без overflow → nextCursor=null, передача `cursor` добавляет `skip:1`, orderBy включает `id` для стабильности.

### Надёжность: step-level retry + idempotencyKey в pipeline orchestrator

Раньше при сбое handler в одном из шагов pipeline (`llm_check`/`llm_qa`) единственным safety-net'ом был job-level retry в BullMQ — он перезапускал handler **с самого начала**, теряя весь прогресс предыдущих шагов. Поле `ProcessingStep.idempotencyKey` существовало в schema, но никем не заполнялось.

- **Новый модуль `apps/workers/src/lib/step-retry.ts`**:
  - Per-level retry config: `deterministic`/`operator_review`/`user_validation` — `maxAttempts=1` (нет смысла ретраить чистую логику или пользовательский гейт); `llm_check`/`llm_qa` — `maxAttempts=3, baseDelayMs=5000` с экспоненциальным backoff
  - `executeStepWithRetry(level, fn)` — оборачивает вызов handler в retry loop, передаёт `attempt` номер в callback для синка с БД
  - `makeIdempotencyKey(processingRunId, level, attempt)` — стабильный ключ `runId:level:attempt` для будущей дедупликации side-effects (например, LLM cost при повторе)
- **`orchestrator.ts`**: вызов `handler.execute()` обёрнут в `executeStepWithRetry`. Перед каждым attempt обновляются `attemptNumber` и `idempotencyKey` в `ProcessingStep`. На retry повторно проставляется `startedAt` для корректной длительности.
- **`metrics.ts`**: к `recordPipelineMetric` добавлено опциональное поле `attempts: number`, чтобы видеть в логах, сколько попыток понадобилось для успеха.
- **Тесты**:
  - `apps/workers/src/lib/__tests__/step-retry.test.ts` (9 кейсов): успех с первой попытки, успех на третьей, exhausted attempts, no-retry для deterministic, exponential backoff с fake timers, idempotencyKey формат
  - `apps/workers/src/pipeline/__tests__/orchestrator.test.ts` (+4 кейса): idempotencyKey ставится на первый attempt, retry с обновлением attemptNumber и нового ключа, exhausted → step `failed`, deterministic не ретраит
- **Pre-existing lint-fix `packages/shared/soa-detection-core.ts`**: убран лишний escape `\-` внутри character class в двух regex.

### Тесты: глубокое покрытие 6 worker handlers

Раньше из 10 worker handlers тестами были покрыты только 4 (`parse-document`, `classify-sections`, `extract-facts`, `intra-doc-audit`). Теперь покрыты все 10 — добавлены тесты для оставшихся 6:

- **`generate-icf.test.ts`** (9 кейсов): регистрация handlers, deterministic читает protocol sections + facts (включая пустой случай), llm_check skip без apiKey, генерация 12 секций, placeholder для отсутствующего source, custom section prompt, trim до inputBudgetChars, propagation LLM-ошибок (no swallowing)
- **`generate-csr.test.ts`** (10 кейсов): то же что ICF + URS-082 (только priority ≤10), URS-063 (instruction future→past tense), фильтрация generation rules по `documentType='csr'`
- **`run-evaluation.test.ts`** (10 кейсов): NOT_FOUND throw, статусы running/completed/failed, skip samples без документов, pass/fail на f1≥0.8, error в stage → status='error', аггрегация per-stage метрик, delta с comparedToRunId, exception → failed, loadActualResults для extraction
- **`run-batch-evaluation.test.ts`** (9 кейсов): NOT_FOUND throw, фильтр status:['parsed','ready'], confidence=classified/total, average fact confidence, confidence buckets, error → null confidence, outer exception, delta, concurrency=5 пакетов
- **`analyze-corrections.test.ts`** (8 кейсов): early return, threshold (≥3 frequency), группировка по (stage,entityType,patternKey), update existing pending recommendation, derivePatternKey, describeSuggestedChange, фильтр isProcessed:false
- **`run-pipeline.test.ts`** (9 кейсов): полный 5-stage flow для protocol, skip extract+SOA для ICF/CSR, статусы на каждом этапе, ProcessingRun с активным bundle, SOA failure → marks SOA failed + rethrows, error в parse/classify → status='error'

Итого 55 новых тестов для workers. Также pre-existing lint-fix `classify-sections.ts:470` (`let parseErrors` → `const`).

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
