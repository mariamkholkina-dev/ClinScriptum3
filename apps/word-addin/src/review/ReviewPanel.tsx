import { useMemo, useState, useEffect } from "react";
import {
  Text,
  Spinner,
  Button,
  Input,
  Badge,
  Checkbox,
  Select,
  Textarea,
  Switch,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Star24Regular } from "@fluentui/react-icons";
import { SeverityBadge } from "../shared/SeverityBadge";
import { StatusBadge } from "../shared/StatusBadge";
import { navigateToText } from "../office-helpers";
import { useReview, effSeverity, type ReviewFinding } from "./useReview";
import { PromoteModal } from "./PromoteModal";

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low", "info"];
// Без false_positive — ложноположительные ловит отдельный фильтр «видимости»
// (Все находки / Не ложные / Ложное срабатывание), иначе два одинаковых пункта
// с разным поведением путали.
const STATUS_OPTIONS = ["pending", "confirmed", "resolved", "rejected"];
const STATUS_LABELS: Record<string, string> = {
  pending: "К валидации",
  confirmed: "Подтверждено",
  resolved: "Исправлено",
  rejected: "Игнорировать",
  false_positive: "Ложное срабатывание",
};

// Направление проверки (как в web). taskKind лежит в extraAttributes/sourceRef.
const TASK_KIND_LABELS: Record<string, string> = {
  self_check: "Внутренняя проверка",
  cross_check: "Перекрёстная проверка",
  self_editorial: "Редакторская проверка",
};
function effTaskKind(f: ReviewFinding): string | null {
  return (f.extraAttributes?.taskKind as string) ?? (f.sourceRef?.taskKind as string) ?? null;
}
/** Зоны находки: якорная и проверяемая (колонки или sourceRef). */
function effZones(f: ReviewFinding): { anchor: string | null; target: string | null } {
  return {
    anchor: f.anchorZone ?? (f.sourceRef?.anchorZone as string) ?? null,
    target: f.targetZone ?? (f.sourceRef?.zone as string) ?? null,
  };
}

const QA_VERDICT_LABELS: Record<string, string> = {
  confirmed: "Подтверждено QA",
  dismissed: "Отклонено QA",
  adjusted: "Скорректировано QA",
  deduplicated: "Дубликат",
};
// Цвета левой полосы цитат (по индексу) — визуально разделяют 1-ю и 2-ю цитату.
const QUOTE_BORDER_COLORS = [
  tokens.colorBrandStroke1,
  tokens.colorPaletteRedBorderActive,
  tokens.colorPalettePurpleBorderActive,
];

const QA_VERDICT_COLORS: Record<string, "success" | "danger" | "warning" | "subtle"> = {
  confirmed: "success",
  dismissed: "danger",
  adjusted: "warning",
  deduplicated: "subtle",
};

const useStyles = makeStyles({
  // height:100% + minHeight:0 — как в ParsingPanel/InterAuditPanel (рабочий
  // паттерн внутри нефлексового styles.content): даёт высоту панели и
  // позволяет внутреннему списку (flex:1, overflowY:auto) прокручиваться.
  // flex:1 здесь НЕ работает (родитель content не display:flex) → ломалась
  // прокрутка и появлялась пустая область.
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
  header: {
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" },
  filters: { display: "flex", gap: "6px", padding: "8px 12px", flexWrap: "wrap" as const },
  bulkBar: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap" as const,
    alignItems: "center",
    padding: "6px 12px",
    backgroundColor: tokens.colorPaletteYellowBackground1,
  },
  list: { flex: 1, minHeight: 0, overflowY: "auto", padding: "8px", borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  detailNav: {
    flex: "none",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    padding: "6px 10px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
    padding: "8px",
    marginTop: "8px",
    cursor: "pointer",
    display: "flex",
    gap: "8px",
  },
  // flexShrink:0 на бейджах: при узкой панели flexbox иначе сжимал бейдж уже
  // его текста, а Fluent Badge режет содержимое по overflow:hidden («К валидации»
  // обрезалось при переносе). Теперь бейджи переносятся целиком, без обрезки.
  badges: { display: "flex", gap: "6px", flexWrap: "wrap" as const, alignItems: "center", "& > *": { flexShrink: 0 } },
  detail: { flex: 1, minHeight: 0, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" },
  blockquote: {
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
    paddingLeft: "10px",
    fontStyle: "italic",
    color: tokens.colorNeutralForeground2,
  },
  actionsBox: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  empty: { display: "flex", alignItems: "center", justifyContent: "center", padding: "32px", color: tokens.colorNeutralForeground3 },
});

export function ReviewPanel({ reviewId }: { reviewId: string }) {
  const styles = useStyles();
  const r = useReview(reviewId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [taskKindFilter, setTaskKindFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [promoteTarget, setPromoteTarget] = useState<string[] | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const findings = r.data?.findings ?? [];
  const isPublished = r.data?.review.status === "published";

  const availableTaskKinds = useMemo(
    () => Array.from(new Set(findings.map(effTaskKind).filter((k): k is string => !!k))).sort(),
    [findings],
  );

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return findings.filter((f) => {
      // «Ложное срабатывание» = скрыто ревьюером ИЛИ помечено конвейером/LLM
      // (status=false_positive) — фильтр ловит оба случая.
      const isFalsePositive = f.hiddenByReviewer || f.status === "false_positive";
      if (severityFilter !== "all" && effSeverity(f) !== severityFilter) return false;
      if (statusFilter !== "all" && f.status !== statusFilter) return false;
      if (taskKindFilter !== "all" && effTaskKind(f) !== taskKindFilter) return false;
      if (visibilityFilter === "hidden" && !isFalsePositive) return false;
      if (visibilityFilter === "visible" && isFalsePositive) return false;
      if (q) {
        const ref = (f.sourceRef ?? {}) as Record<string, unknown>;
        const hay = [
          f.description,
          f.suggestion,
          ref.textSnippet, ref.anchorQuote, ref.targetQuote, ref.referenceQuote,
        ]
          .filter((x): x is string => typeof x === "string")
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [findings, searchText, severityFilter, statusFilter, taskKindFilter, visibilityFilter]);

  // Выбранную находку ищем по id в ПОЛНОМ списке, а не в отфильтрованном:
  // иначе при смене критичности (если активен фильтр по severity) находка
  // выпадала из filtered и детализация сбрасывалась/«перескакивала».
  // selectedIndex (в filtered) нужен только для навигации ←/→.
  const selectedIndex = filtered.findIndex((f) => f.id === selectedId);
  const selected = findings.find((f) => f.id === selectedId) ?? null;
  const hiddenCount = findings.filter((f) => f.hiddenByReviewer).length;

  const toggleSel = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selArr = Array.from(selectedIds);
  const clearSel = () => setSelectedIds(new Set());
  const selectAllFiltered = () => setSelectedIds(new Set(filtered.map((f) => f.id)));

  if (r.loading && !r.data) {
    return <div className={styles.empty}><Spinner label="Загрузка ревью..." /></div>;
  }
  if (!r.data) {
    return (
      <div className={styles.empty}>
        <Text>{r.error ?? "Ревью не найдено"}</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Text weight="semibold" size={300}>{r.data.documentTitle}</Text>
            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>{r.data.versionLabel}</Text>
          </div>
          {isPublished ? (
            <Badge appearance="tint" color="success">Опубликовано</Badge>
          ) : confirmPublish ? (
            <div style={{ display: "flex", gap: 4 }}>
              <Button size="small" appearance="primary" disabled={r.busy} onClick={() => r.publish()}>
                Да, завершить
              </Button>
              <Button size="small" appearance="subtle" onClick={() => setConfirmPublish(false)}>Отмена</Button>
            </div>
          ) : (
            <Button size="small" appearance="primary" onClick={() => setConfirmPublish(true)}>
              Завершить ревью
            </Button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            По фильтру: {filtered.length} из {findings.length} · скрытых: {hiddenCount}
          </Text>
        </div>
      </div>

      {r.error && (
        <MessageBar intent="error"><MessageBarBody>{r.error}</MessageBarBody></MessageBar>
      )}

      {!selected && (
        <>
          <div className={styles.filters}>
            <Input
              size="small"
              placeholder="Поиск по тексту находки…"
              value={searchText}
              onChange={(_, d) => setSearchText(d.value)}
              style={{ width: "100%" }}
            />
            <Select size="small" value={severityFilter} onChange={(_, d) => setSeverityFilter(d.value)}>
              <option value="all">Все серьёзности</option>
              {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select size="small" value={statusFilter} onChange={(_, d) => setStatusFilter(d.value)}>
              <option value="all">Все статусы</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </Select>
            {availableTaskKinds.length > 0 && (
              <Select size="small" value={taskKindFilter} onChange={(_, d) => setTaskKindFilter(d.value)}>
                <option value="all">Все направления</option>
                {availableTaskKinds.map((k) => (
                  <option key={k} value={k}>{TASK_KIND_LABELS[k] ?? k}</option>
                ))}
              </Select>
            )}
            <Select size="small" value={visibilityFilter} onChange={(_, d) => setVisibilityFilter(d.value)}>
              <option value="all">Все находки</option>
              <option value="visible">Не ложные</option>
              <option value="hidden">Ложное срабатывание</option>
            </Select>
          </div>

          {!isPublished && selectedIds.size > 0 && (
            <div className={styles.bulkBar}>
              <Text size={200} weight="semibold">Выбрано: {selectedIds.size}</Text>
              <Button size="small" appearance="subtle" onClick={selectAllFiltered}>Выбрать все ({filtered.length})</Button>
              <Button size="small" appearance="subtle" onClick={clearSel}>Снять все</Button>
              <Button size="small" disabled={r.busy} onClick={() => { r.bulkSetHidden(selArr, true); clearSel(); }}>Скрыть</Button>
              <Button size="small" disabled={r.busy} onClick={() => { r.bulkSetHidden(selArr, false); clearSel(); }}>Показать</Button>
              <Select size="small" value="" disabled={r.busy}
                onChange={(_, d) => { if (d.value) { r.bulkChangeSeverity(selArr, d.value); clearSel(); } }}>
                <option value="">Серьёзность…</option>
                {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Button size="small" icon={<Star24Regular />} onClick={() => setPromoteTarget(selArr)}>В эталон</Button>
              <Button size="small" disabled={r.busy} onClick={() => { r.restoreFromFalsePositive(selArr); clearSel(); }}>
                На валидацию
              </Button>
            </div>
          )}

          <div className={styles.list}>
            {filtered.length === 0 && <div className={styles.empty}><Text>Нет находок</Text></div>}
            {filtered.map((f) => (
              <ReviewCard
                key={f.id}
                f={f}
                checked={selectedIds.has(f.id)}
                selectable={!isPublished}
                onCheck={() => toggleSel(f.id)}
                onOpen={() => setSelectedId(f.id)}
              />
            ))}
          </div>
        </>
      )}

      {selected && (
        <>
          {/* Фиксированная панель навигации: «К списку» + переход между находками */}
          <div className={styles.detailNav}>
            <Button size="small" appearance="subtle" onClick={() => setSelectedId(null)}>
              ☰ К списку
            </Button>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Button
                size="small"
                appearance="subtle"
                disabled={selectedIndex <= 0}
                onClick={() => setSelectedId(filtered[selectedIndex - 1]?.id ?? null)}
              >
                ← Назад
              </Button>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {selectedIndex + 1} / {filtered.length}
              </Text>
              <Button
                size="small"
                appearance="subtle"
                disabled={selectedIndex >= filtered.length - 1}
                onClick={() => setSelectedId(filtered[selectedIndex + 1]?.id ?? null)}
              >
                Вперёд →
              </Button>
            </div>
          </div>
          <ReviewDetail
            f={selected}
            sections={r.data.sections ?? []}
            isPublished={isPublished}
            busy={r.busy}
            onToggleHidden={() => r.toggleHidden(selected.id)}
            onChangeSeverity={(s) => r.changeSeverity(selected.id, s)}
            onSaveNote={(note) => r.addNote(selected.id, note)}
            onPromote={() => setPromoteTarget([selected.id])}
            onRestore={() => r.restoreFromFalsePositive([selected.id])}
          />
        </>
      )}

      {promoteTarget && (
        <PromoteModal
          findingIds={promoteTarget}
          loadSamples={r.listGoldenSamples}
          promote={r.promoteToGolden}
          onClose={() => { setPromoteTarget(null); r.refetch(); }}
        />
      )}
    </div>
  );
}

function ReviewCard({
  f, checked, selectable, onCheck, onOpen,
}: {
  f: ReviewFinding;
  checked: boolean;
  selectable: boolean;
  onCheck: () => void;
  onOpen: () => void;
}) {
  const styles = useStyles();
  const sev = effSeverity(f);
  return (
    <div className={styles.card} onClick={onOpen}>
      {selectable && (
        <div onClick={(e) => e.stopPropagation()} style={{ paddingTop: 2 }}>
          <Checkbox checked={checked} onChange={onCheck} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={styles.badges}>
          <SeverityBadge severity={sev} />
          <StatusBadge status={f.status} />
          {effTaskKind(f) && (
            <Badge appearance="outline" color="informative" size="small">
              {TASK_KIND_LABELS[effTaskKind(f)!] ?? effTaskKind(f)}
            </Badge>
          )}
          {f.hiddenByReviewer && <Badge appearance="tint" color="danger" size="small">Ложное</Badge>}
        </div>
        <Text size={200} style={{ display: "block", marginTop: 4 }}>{f.description}</Text>
        {f.reviewerNote && (
          <Text size={100} style={{ color: tokens.colorPalettePurpleForeground2 }}>📝 заметка</Text>
        )}
      </div>
    </div>
  );
}

function ReviewDetail({
  f, sections, isPublished, busy, onToggleHidden, onChangeSeverity, onSaveNote, onPromote, onRestore,
}: {
  f: ReviewFinding;
  sections: { title: string; standardSection: string | null; content: string }[];
  isPublished: boolean;
  busy: boolean;
  onToggleHidden: () => void;
  onChangeSeverity: (s: string) => void;
  onSaveNote: (note: string) => void;
  onPromote: () => void;
  onRestore: () => void;
}) {
  const styles = useStyles();
  const ref = f.sourceRef as any;
  const [note, setNote] = useState(f.reviewerNote ?? "");
  const sev = effSeverity(f);
  const isFalsePositive = f.status === "false_positive";

  // Заголовок раздела, содержащего цитату — чтобы переход в Word искал текст
  // именно в этом разделе (а не первое одноимённое вхождение по всему документу).
  // Среди разделов с этой цитатой предпочитаем те, что в зоне(ах) находки.
  const sectionHeadingFor = (quote: string): string | undefined => {
    const probe = quote.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
    if (probe.length < 12) return undefined;
    const cands = sections.filter(
      (s) => s.content.toLowerCase().replace(/\s+/g, " ").includes(probe),
    );
    if (cands.length === 0) return undefined;
    const z = effZones(f);
    const zones = [z.anchor, z.target].filter((zz): zz is string => !!zz);
    const inZone = (s: { standardSection: string | null }) => {
      if (zones.length === 0) return true;
      const root = (s.standardSection ?? "").split(".")[0];
      return zones.some(
        (zz) => root === zz || s.standardSection === zz || (s.standardSection ?? "").startsWith(zz + "."),
      );
    };
    return (cands.find(inZone) ?? cands[0]).title;
  };

  // Места в документе, на которые ссылается находка, по порядку (1-е и 2-е).
  const quoteList = useMemo(() => {
    // Два места находки. У cross-check это referenceQuote (якорь/референс) и
    // textSnippet (проверяемая зона) — targetQuote/anchorQuote там НЕТ, поэтому
    // их раздельно собирать нельзя. Берём «якорное» и «проверяемое» места из
    // доступных полей и добавляем все остальные непустые цитаты как запас.
    const anchor = ref?.anchorQuote || ref?.referenceQuote || ref?.protocolQuote;
    const target = ref?.textSnippet || ref?.targetQuote || ref?.checkedDocQuote;
    const list: string[] = [];
    const add = (q: unknown) => {
      if (typeof q === "string" && q.trim() && !list.includes(q)) list.push(q);
    };
    add(anchor);
    add(target);
    // На случай нестандартного sourceRef — подхватываем любые оставшиеся цитаты.
    for (const k of ["referenceQuote", "anchorQuote", "textSnippet", "targetQuote", "protocolQuote", "checkedDocQuote"]) {
      add(ref?.[k]);
    }
    return list;
  }, [f.id]);
  const [navIdx, setNavIdx] = useState(0);

  const goToQuote = (i: number) => {
    if (i < 0 || i >= quoteList.length) return;
    setNavIdx(i);
    void navigateToText(quoteList[i], sectionHeadingFor(quoteList[i]));
  };

  // При открытии карточки находки — автопереход на первое место в документе.
  useEffect(() => {
    setNavIdx(0);
    if (quoteList.length > 0) void navigateToText(quoteList[0], sectionHeadingFor(quoteList[0]));
  }, [f.id]);

  return (
    <div className={styles.detail}>

      <div className={styles.badges}>
        <SeverityBadge severity={sev} />
        <StatusBadge status={f.status} />
        {effTaskKind(f) && (
          <Badge appearance="outline" color="informative" size="small">
            {TASK_KIND_LABELS[effTaskKind(f)!] ?? effTaskKind(f)}
          </Badge>
        )}
        {f.hiddenByReviewer && <Badge appearance="tint" color="danger" size="small">Ложное срабатывание</Badge>}
        {f.originalSeverity && f.originalSeverity !== sev && (
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            Алгоритм: {f.originalSeverity}
          </Text>
        )}
      </div>

      {/* Восстановление ошибочно помеченной ложноположительной находки */}
      {isFalsePositive && (
        <Button size="small" disabled={busy} onClick={onRestore} style={{ alignSelf: "flex-start" }}>
          Вернуть на валидацию
        </Button>
      )}

      <Text weight="semibold" size={300}>{f.description}</Text>

      {(() => {
        const z = effZones(f);
        if (!z.anchor && !z.target) return null;
        return (
          <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
            {z.anchor && z.target && z.anchor !== z.target
              ? `Зоны: ${z.anchor} → ${z.target}`
              : `Зона: ${z.target ?? z.anchor}`}
          </Text>
        );
      })()}

      {f.suggestion && (
        <div>
          <Text size={200} weight="semibold" style={{ display: "block", color: tokens.colorPaletteGreenForeground1 }}>
            Рекомендация
          </Text>
          <Text size={200} style={{ color: tokens.colorPaletteGreenForeground1 }}>
            {f.suggestion}
          </Text>
        </div>
      )}

      {quoteList.length > 0 && (
        <div>
          <Text size={200} weight="semibold" style={{ display: "block", marginBottom: 4 }}>
            Цитаты из документа{quoteList.length > 0 ? " — нажмите для перехода" : ""}
          </Text>
          {quoteList.map((q, i) => (
            <div
              key={i}
              className={styles.blockquote}
              onClick={() => goToQuote(i)}
              title="Перейти к этому месту в документе"
              style={{
                cursor: "pointer",
                // Разный цвет левой полосы — чтобы две цитаты не выглядели как одна.
                borderLeftWidth: 4,
                borderLeftColor: QUOTE_BORDER_COLORS[i % QUOTE_BORDER_COLORS.length],
                marginBottom: 8,
                backgroundColor: i === navIdx ? tokens.colorNeutralBackground1Selected : undefined,
              }}
            >
              {quoteList.length > 1 && (
                <Text
                  size={100}
                  weight="semibold"
                  style={{ display: "block", color: QUOTE_BORDER_COLORS[i % QUOTE_BORDER_COLORS.length] }}
                >
                  Цитата {i + 1}
                </Text>
              )}
              <Text size={200}>{q}</Text>
            </div>
          ))}
        </div>
      )}

      {/* QA-верификация — особенно важна для ложноположительных (почему QA её
          отклонил/скорректировал). */}
      {(f.extraAttributes?.qaVerdict || f.extraAttributes?.qaReason) && (
        <div className={styles.actionsBox}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Text weight="semibold" size={200}>QA-верификация</Text>
            {f.extraAttributes?.qaVerdict && (
              <Badge
                appearance="tint"
                color={QA_VERDICT_COLORS[f.extraAttributes.qaVerdict as string] ?? "informative"}
                size="small"
              >
                {QA_VERDICT_LABELS[f.extraAttributes.qaVerdict as string] ?? f.extraAttributes.qaVerdict}
              </Badge>
            )}
          </div>
          {f.extraAttributes?.qaReason && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
              {f.extraAttributes.qaReason as string}
            </Text>
          )}
        </div>
      )}


      {/* Действия ревьюера */}
      <div className={styles.actionsBox}>
        <Text weight="semibold" size={200}>Действия ревьюера</Text>

        {!isPublished && (
          <Switch
            checked={f.hiddenByReviewer}
            disabled={busy}
            onChange={onToggleHidden}
            label="Ложное срабатывание (скрыть от писателя)"
          />
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Text size={200}>Серьёзность:</Text>
          <Select
            size="small"
            value={sev}
            disabled={isPublished || busy}
            onChange={(_, d) => onChangeSeverity(d.value)}
          >
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size={200}>Заметка:</Text>
          <Textarea
            value={note}
            disabled={isPublished || busy}
            onChange={(_, d) => setNote(d.value)}
            placeholder="Комментарий к находке..."
            resize="vertical"
          />
          <Button
            size="small"
            disabled={isPublished || busy || note === (f.reviewerNote ?? "")}
            onClick={() => onSaveNote(note)}
            style={{ alignSelf: "flex-end" }}
          >
            Сохранить заметку
          </Button>
        </div>

        <Button size="small" icon={<Star24Regular />} onClick={onPromote} style={{ alignSelf: "flex-start" }}>
          В эталон
        </Button>
      </div>
    </div>
  );
}
