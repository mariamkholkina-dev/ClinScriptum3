# Golden coverage — fact_extraction stage

**Дата:** 2026-05-04
**Tenant:** Golden Set (`00000000-0000-0000-0000-000000000002`)
**Бранч:** `chore/golden-fact-extraction-coverage`
**Скрипт:** `apps/workers/scripts/audit-golden-fact-extraction-coverage.ts`
**Машинный снапшот:** [`golden-fact-extraction-coverage-2026-05-04.json`](./golden-fact-extraction-coverage-2026-05-04.json)

## Снапшот

| Метрика                              | Значение |
|--------------------------------------|---------:|
| Всего golden samples                 |        4 |
| С строкой stage_status fact_extraction |      0 |
| С непустым `expectedResults`         |        0 |
| approved                             |        0 |
| in_review                            |        0 |
| draft                                |        0 |
| Сумма factKey по всем samples        |        0 |
| Цель approved                        |       30 |
| **Дефицит до цели**                  |   **30** |

## Sample'ы в текущем датасете

| ID                                     | Имя                | fact_extraction stage | factKeys | Total facts |
|----------------------------------------|--------------------|----------------------:|---------:|------------:|
| `5883f8c0-b84d-4c3f-afa9-04a75becc93e` | FNT-AS-III-2026    | —                     | 0        | 0           |
| `c0dc009c-3466-4f85-ae89-e8b6374ebf9c` | STP-08-25          | —                     | 0        | 0           |
| `f7fbd25b-7ed3-477d-aaa4-ce1c90bf3cea` | VLT-015-II/2025    | —                     | 0        | 0           |
| `f149947b-12a4-4fa4-84db-f535af8c52ca` | Тетра-AHAGGN-11/25 | —                     | 0        | 0           |

## Что это значит для Sprint 6

- **PR 2 (baseline run)** — заблокирован. Метрики `factCoverage` / `parseErrorRate` сравнивать не с чем, потому что нет `expectedResults`.
- **PR 3 (calibration)** — заблокирован. `scripts/calibrate-confidence.ts` фитит коэффициенты на размеченных samples; без целевых факт-значений он не имеет данных.
- **PR 4 (active-learning UI)** — **не** заблокирован: читает уже накопленные `CorrectionRecommendation`, не golden samples.

## Варианты разблокировки

### A. Полный (по original plan, acceptance gate соблюдён буквально)
- Разметить 4 имеющихся + добавить 26 новых протоколов в Golden Set.
- Время: ~2-3 недели работы эксперта (1-2 протокола в день).
- Плюсы: статистика на 30 samples даёт надёжные дельты ≥ 1 п.п.
- Минусы: большая задержка перед PR 2/3.

### B. Прагматичный
- Разметить только 4 имеющихся, понизить cap первого baseline'а до 4.
- Acceptance временно снижается до `factCoverage ≥ 0.85 на ≥ 4 samples` для Sprint 6, цель 30 — в Sprint 7.
- Время: ~3-4 дня эксперта.
- Минусы: статистика на 4 samples шумная, дельты ≤ 5 п.п. ненадёжны.

### C. Параллельный (рекомендуется)
- Вариант B сейчас + копить датасет фоном (target 30 к Sprint 7).
- Sprint 6 проходит на маленькой выборке за 1-2 недели, Sprint 7 повторяет baseline на полном датасете.
- Минусы: дополнительные затраты на повторный baseline в Sprint 7.

## Действия

1. **Эксперту:** разметить 4 имеющихся sample'а через `/golden-dataset/[id]` UI, создать `GoldenSampleStageStatus(stage='fact_extraction')` с `expectedResults`, перевести в `approved`.
2. **После разметки:** повторить аудит-скрипт, обновить этот файл и JSON-снапшот.
3. **Зафиксировать выбранную стратегию** (A / B / C) в memory `project_fact_extraction_deferred.md` и обновить acceptance gate.

## Команды

Перегенерация снапшота:

```powershell
cd C:\Users\0\ClinScriptum3-golden-coverage
npx tsx --env-file=.env apps/workers/scripts/audit-golden-fact-extraction-coverage.ts
npx tsx --env-file=.env apps/workers/scripts/audit-golden-fact-extraction-coverage.ts --json `
  > docs/baselines/golden-fact-extraction-coverage-2026-05-04.json
```
