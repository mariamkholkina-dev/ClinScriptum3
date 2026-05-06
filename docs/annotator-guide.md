# Инструкция разметчика — классификация секций протоколов

Версия: 2026-05-06 (после deploy Phase 2 + Track A/B/C + corpus discovery)
Аудитория: разметчик golden dataset для tenant `Corpus 2026-05-06`

## 1. Что мы размечаем и зачем

Мы готовим **эталонный набор** (golden dataset) для оценки качества автоматического классификатора секций. На каждый раздел протокола ты ставишь **правильный** `standardSection` — например, `population.inclusion`, `safety.adverse_events.reporting`, `design.visit_schedule`.

Затем алгоритм сравнивает свои предсказания с твоей разметкой → метрики precision / recall / f1. Чем точнее разметка, тем лучше алгоритм будет тренироваться.

## 2. Workflow в rule-admin (как открывать sample)

1. **Первое открытие страницы** — браузер запросит HTTP Basic Auth (всплывающее окно «Требуется аутентификация»). Введи логин `devuser` и пароль (запросить у эксперта/тех-поддержки). Это защита dev-окружения через nginx — НЕ путать с login в приложение
2. После basic auth — открой rule-admin (`https://rule-admin.dev.clinscriptum.ru`) и войди под `admin@corpus.local`
3. Левое меню → **Эталонные наборы** → откроется список из ~156 sample (по одному на загруженный протокол)
4. Кликни на любой sample (например, `APEIRON APN01-01-COVID19...`)
5. Откроется страница sample с разделами этапов: **Парсинг → Классификация → (Извлечение фактов / SOA — позже)**
6. Каждый этап имеет независимую разметку. Сначала проверяем парсинг (структуру), потом классификацию.

**Скачать оригинальный DOCX-файл:** на странице sample → строка документа → кнопка **«Выгрузить»** (иконка стрелки вниз справа в строке). Это нужно для сравнения с результатом парсинга и проверки сложных случаев.

**Английские протоколы пропускаем.** На текущем этапе мы размечаем только русскоязычные документы. Если открыла sample с DOCX полностью на английском (а не русский с отдельными английскими разделами/терминами) — поставь все этапы в статус `skipped` (или оставь `draft` и переходи к следующему). В комментарии к sample напиши «English-only document, skipped». Эксперт потом отдельно решит когда расширять разметку на англ.

## 3. Этап «Парсинг» — проверка структуры документа

**Цель этапа:** убедиться, что parser правильно извлёк **иерархию разделов** из DOCX. Если структура неправильная (пропущены секции, лишние секции, неправильный уровень вложенности) — все следующие этапы (классификация, факты) будут работать на испорченных данных. Поэтому парсинг — фундамент.

### Что делать

1. На странице sample → этап **Парсинг** → откроется дерево секций которое получилось у parser
2. Скачай оригинальный DOCX через кнопку «Выгрузить» в строке документа
3. Открой DOCX в Word рядом с UI
4. Пройдись по оглавлению/структуре в Word и сравни с деревом в UI

### Что искать

| Тип ошибки | Признак | Что делать |
|---|---|---|
| **Пропущенная секция** | В Word есть раздел, в дереве UI его нет | Помечай как «не хватает раздела X» в комментарии sample, эксперт решит |
| **Лишняя секция** (false heading) | В дереве UI есть строка, которая в Word явно не заголовок (это часть таблицы, footnote, page header) | В UI помечай как **isFalseHeading=true** (если есть кнопка) или как «вопрос эксперту» |
| **Неправильный уровень** | Раздел в Word — h2 (1.1), а в дереве он попал в h1 как top-level | Помечай в комментарии — parser неправильно определил level |
| **Объединённые секции** | Два раздела в Word склеены в один в дереве | Помечай в комментарии |
| **Раздел с пустым содержимым** (всё нормально) | Section в дереве есть, но контент пустой — это OK, если в Word тоже пустая секция или только заголовок | Принимай |

### Авто-фильтры (что parser уже убирает)

Parser автоматически **НЕ** добавляет в дерево:
- **TOC entries** — строки оглавления вроде «1 Синопсис 13», «2 Обоснование 33» (с номерами страниц)
- **SoA-cells** — ячейки таблицы расписания вроде «День 5», «Visit 3», «Неделя 2 (визит 4)»
- **Footnote rows** — комментарии к таблицам вида «3 – рандомизация будет осуществлена...» (цифра + дефис + lowercase)

Если ты увидела что-то из этого как секцию в дереве — значит фильтр не сработал на этом конкретном случае. Помечай как `? Вопрос эксперту` и опиши какой паттерн пропустился.

### Когда заканчивать этап Парсинг

Когда дерево UI **структурно совпадает** с заголовками в DOCX (с допустимыми мелкими расхождениями) → меняй status этапа Парсинг с `draft` → `in_review` → дождись ответов эксперта → `approved`. Только после этого переходи к этапу Классификация.

## 4. Workflow для этапа «Классификация» (после парсинга)

Когда этап Парсинг утверждён (`approved`), открывай этап **Классификация**.

### Как открыть annotation page

На странице sample → разверни этап «Классификация» → нажми кнопку **«Разметить →»**. Откроется специальная страница `/annotate/{sampleId}/classification` с annotation UI.

### UI annotation page

Слева — список секций со статусом разметки (Ожидает / Принято / Изменено / Вопрос / Решено). Фильтр сверху: «Все», «Ожидают», «Вопросы».

Справа — детали текущей секции:
- **Заголовок** + level + order
- **Предсказание алгоритма** — какую zone предложил classifier + confidence
- **Уже размечено** (если annotation существует) — твоё предыдущее решение + decision эксперта если был вопрос
- **Действия** — три кнопки:
  - **✓ Принять предсказание (Y)** — алгоритм был прав, ставим predicted zone и идём дальше
  - **✗ Изменить** — выбери из dropdown правильную zone и нажми «Изменить»
  - **? Вопрос эксперту (Q)** — переключает на текстовое поле, ты пишешь вопрос → «Отправить вопрос». Эксперт увидит его в /expert-review

После каждого submit — auto-advance на следующую секцию.

### Хотkeys

- `Y` — принять предсказание текущей секции
- `Q` — переключить режим «вопрос»
- `↑` / `k` — предыдущая секция
- `↓` / `j` — следующая секция
- `?` — показать справку по hotkeys

### Когда закончила

В правом верхнем углу — кнопка **«Отправить на проверку»**. Она:
1. Берёт все твои annotations (zone + ответы экспертом на вопросы) и записывает в `expected_results.sections`
2. Меняет status этапа `draft` → `in_review`
3. Открытые вопросы (без ответа эксперта) остаются в очереди — они не финализируются

### Workflow status

1. `draft` — ты только начала, никаких annotations
2. `in_review` — ты нажала «Отправить на проверку», ждёшь эксперта
3. `approved` — эксперт проверил всё и поставил окончательно. **Этот статус ставит только эксперт**, не ты

## 5. Принцип выбора zone / subzone

**Важно различать:**

- **Иерархия в дереве документа** — это структура DOCX. Например, Section «3.1 Информированное согласие» может быть child секции «3. Этика». Это структурная вложенность.
- **Иерархия в taxonomy** — это classification. Зона `ethics` имеет subzone `ethics.informed_consent`. Это атрибут классификации.

**Эти две иерархии НЕ обязаны совпадать.** Subzone — это просто более узкая категория, она НЕ требует чтобы родительская секция в дереве документа была размечена как parent zone.

Примеры:
- Section «Информированное согласие» в дереве документа может быть **top-level** (level 1, не дочерней). При этом её правильная классификация — `ethics.informed_consent` (subzone). Это нормально.
- Section «Расписание визитов» может быть child секции «Дизайн исследования» (зона `design`). Subzone `design.visit_schedule` логично использует тот же parent prefix `design.*`. Но **тоже допустимо** если эта секция top-level — классификация остаётся `design.visit_schedule`.
- Section «Сообщение об AE» в документе может быть под parent «Безопасность» (`safety`) — тогда subzone `safety.adverse_events.reporting` логичная. Но **алгоритм всё равно** оценивает классификацию по контенту секции, а не по parent в дереве.

### Что это значит на практике

При выборе zone/subzone — **смотри на содержимое секции**, а не на её родительскую секцию в дереве. Если контент про конкретную subzone — ставь именно эту subzone, даже если в документе она структурно стоит вне «правильного» parent.

### Доступные zones и их subzones (для справки)

| Zone | Subzones (примеры) |
|---|---|
| `overview` | introduction, rationale, objectives, synopsis, definitions |
| `design` | study_design, study_type, study_phases, blinding_and_unblinding, randomization, visit_schedule, study_duration, discontinuation_criteria, unscheduled_visits |
| `ip` | description, dosing_and_administration, preclinical_clinical_data, comparator, contraindications, concomitant_therapy, packaging_and_labeling, storage_and_accountability |
| `population` | eligibility_criteria, demographics_and_baseline, sample_size, withdrawal_and_replacement, vulnerable_groups |
| `procedures` | screening, physical_examination, vital_signs, laboratory_assessments, imaging, sample_handling, patient_reported_outcomes, compliance, contraception_requirements, lifestyle, protocol_deviations, emergency_actions |
| `endpoints` | primary, secondary, exploratory, efficacy, pharmacokinetics |
| `safety` | adverse_events, adverse_events.reporting, adverse_events.definitions, risk_benefit_assessment, identified_risks, pharmacovigilance |
| `statistics` | analysis_plan, analysis_methods, analysis_populations, sample_size_justification, missing_data_handling |
| `data_management` | data_collection, data_handling_and_storage, quality_control, crf_and_edc |
| `ethics` | ethical_considerations, informed_consent, irb_iec, confidentiality, regulatory_compliance |
| `admin` | sponsor_and_investigators, study_monitoring, publication_policy, financing_and_insurance, protocol_amendments, investigator_responsibilities, protocol_approval |
| `appendix` | references, tables, glossary |

### Когда ставить parent zone, а когда subzone

- Ставь **subzone** если контент чётко относится к узкой категории. Например, секция целиком про «информированное согласие» → `ethics.informed_consent` (а не общий `ethics`)
- Ставь **parent zone** (без subzone) если контент общий и не подходит ни под одну existing subzone. Например, общий обзор «Безопасность» с разными подразделами → `safety`
- Если кажется что subzone должна быть, но её нет в списке — **задай вопрос эксперту**, возможно нужно расширить taxonomy

**Если контент про `clinical study`/`clinical trial` (а не про данные) — это НЕ `ip.preclinical_clinical_data`!** Такие случаи в большинстве это:
- «Обоснование клинического исследования» → `overview.rationale`
- «Цели клинического исследования» → `overview.objectives`
- Просто title протокола → не классифицировать (skip)

## 6. Новые subzones (добавлены 2026-05-06 на основе анализа корпуса)

Если видишь раздел с этим заголовком — теперь есть отдельная subzone:

| Раздел | Subzone | Что туда входит |
|---|---|---|
| «Обязанности исследователя» | `admin.investigator_responsibilities` | Что должен делать главный исследователь / спонсор |
| «Страница одобрения протокола» | `admin.protocol_approval` | Подписи спонсора/исследователя под протоколом (НЕ etic-comittee approval — то ethics) |
| «Незапланированные визиты», «Внеплановые визиты» | `design.unscheduled_visits` | Визиты вне плана (а не плановые из visit_schedule) |
| «Отклонения от протокола», «Protocol deviations» | `procedures.protocol_deviations` | Регистрация и сообщение об отклонениях. **НЕ путать с amendments** (`admin.protocol_amendments` — формальные правки протокола) |
| «Действия в неотложных ситуациях», «Emergency actions» | `procedures.emergency_actions` | Что делать при критическом событии |
| «Важные потенциальные риски», «Identified risks», «Known risks» | `safety.identified_risks` | Перечень рисков. **НЕ путать с** `safety.risk_benefit_assessment` (там оценка соотношения польза/риск) |

## 7. Расширенные правила для existing subzones

### `procedures.lifestyle`

Теперь ловит больше формулировок. Это всё `procedures.lifestyle`:
- «Ограничения в питании, образе жизни и приёме лекарственных препаратов»
- «Ограничения по питанию»
- «Ограничения по активности»
- «Режим питания», «Режим жизни», «Режим дня»
- «Образ жизни», «Физическая активность»
- «Lifestyle modifications/restrictions»

### `ip.preclinical_clinical_data`

Сужено — теперь это **только данные/результаты**:
- «Доклинические данные», «Preclinical studies», «Toxicology data»
- «Клинические данные предыдущих исследований»
- «Результаты значимых доклинических и клинических исследований»

**НЕ относится сюда** (раньше алгоритм ошибочно ловил):
- «Обоснование клинического исследования» → `overview.rationale`
- «Цели клинического исследования» → `overview.objectives`
- Заголовок протокола / sponsor info → skip или `admin.sponsor_and_investigators`

## 8. Когда задавать вопрос эксперту

Используй кнопку `? Вопрос эксперту` (НЕ ставь произвольную zone и НЕ skip), если:

1. **Ты не уверена** между двумя похожими subzones (например, `safety.adverse_events.reporting` vs `safety.pharmacovigilance` — оба про сообщения о AE, разница тонкая)
2. **Раздел не подходит** ни под одну текущую zone (возможно, нужна новая subzone в taxonomy)
3. **Заголовок странный или некачественный** — например это явно tableкр строка с «Месяц 6, Визит 9» которая не отфильтровалась, или footnote попавший в дерево
4. **Один и тот же контент** размечен по-разному в разных протоколах, и ты сомневаешься какой стандарт правильный
5. **Содержимое противоречит заголовку** — например, заголовок «Безопасность», а контент про статистику

В комментарии к вопросу пиши **что именно непонятно**, а не «не знаю». Эксперт читает комментарий и принимает решение → ответ записывается в audit trail и применяется как правило для будущих похожих случаев.

## 9. Типичные ошибки и confusion pairs

Эти случаи algoritm часто путает (на твою разметку нужно особое внимание):

| Часто путается | Правильный выбор по контенту |
|---|---|
| `ip` vs `ip.description` | `ip.description` если есть **описание** препарата (форма, состав); `ip` если общий обзор без деталей |
| `ip` vs `ip.comparator` | `ip.comparator` если речь о препарате **сравнения** (active control), `ip` если про основной IMP |
| `safety` vs `safety.risk_benefit_assessment` | `safety.risk_benefit_assessment` если **сравнение** польза/риск; `safety` если общая глава |
| `safety.adverse_events.reporting` vs `safety.pharmacovigilance` | `reporting` — про процедуру сообщения; `pharmacovigilance` — про систему фарманаждзора в целом |
| `design.blinding_and_unblinding` vs `design.randomization` | По контенту: blinding = ослепление/раскрытие, randomization = рандомизация распределения |
| `endpoints.pharmacokinetics` vs `statistics.analysis_methods` | Если описывается **метод сбора PK** — `endpoints.pharmacokinetics`. Если описывается **статистический анализ** PK данных — `statistics.analysis_methods` |
| `overview.rationale` vs `ip.preclinical_clinical_data` | Если «обоснование» — `overview.rationale`. Только если конкретные **данные** доклиники — `ip.preclinical_clinical_data` |
| `procedures.lifestyle` vs `population.exclusion` | Lifestyle — ограничения **во время** исследования (диета, активность). Exclusion — критерии исключения **до** входа |
| `procedures.contraception_requirements` vs `safety.adverse_events.reporting` | Беременность как **контрацепция** → contraception. Беременность как **adverse event** → safety reporting |

## 10. Чеклист на каждом sample

1. Открой sample, посмотри на title — это сам протокол (его НЕ классифицируй, это title документа, не section)
2. Пройдись по дереву сверху вниз
3. Для каждой section:
   - Прочти **title** + первые 2-3 строки **content** (поможет понять контекст)
   - Если algorithm уже предложил `standardSection` — проверь что zone подходит
   - Если zone подходит, но subzone не попал (например предложен parent `ip`, а контент явно `ip.description`) — поправь на subzone
   - Если совсем не уверена — `? Вопрос эксперту`
4. Когда все обработано — change status `classification` → `in_review`
5. После того как эксперт ответил → status `approved`
6. Переходи к следующему sample

## 11. Что ты НЕ делаешь

- **Не правь parser** — если секция не должна быть разделом (например это footnote попавший в дерево) — отметь как ложный заголовок (если есть такая опция) или задай вопрос эксперту
- **Не трогай уже approved samples** — это работа эксперта (revert через snapshot)
- **Не выдумывай новые zones** — пиши вопрос эксперту, тогда он добавит в taxonomy.yaml
- **Не классифицируй titles протоколов** (типа «Протокол клинического исследования NCT12345...») — это title документа

## 12. Полезные ссылки

- Эта инструкция: `docs/annotator-guide.md`
- Полная иерархия зон: `taxonomy.yaml` (файл репо)
- История baseline'ов: `docs/baselines/*.json`
- Спецификация эталонного процесса: `docs/section-classification-quality-plan.md`

## 13. Контакты

- Вопросы про zone выбора → задавай через `? Вопрос эксперту` в UI (не пиши экспертам в мессенджер — теряется audit trail)
- Технические проблемы UI / pipeline / медленная страница → отдельный канал (Slack #clinscriptum-tech)
- Срочное (полная блокировка работы) → expert lead напрямую

---

**Версия документа:** 2026-05-06  
**Изменения от предыдущей версии:** добавлены 6 новых subzones (Track B), уточнения для `procedures.lifestyle` (Track A) и `ip.preclinical_clinical_data` (B1), описание авто-фильтров parser (Track C — TOC, SoA-cells, footnote rows).
