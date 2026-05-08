"use client";

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { trpc } from "@/lib/trpc";
import { openInWord } from "@/lib/open-in-word";
import {
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  ChevronsUpDown,
  Filter,
  Columns2,
  GitCompareArrows,
  CheckSquare,
  Square,
  Keyboard,
  X,
  CornerDownRight,
  EyeOff,
  Eye,
} from "lucide-react";

import type {
  Section,
  AnomalyType,
  DiffEntry,
  SortKey,
  FilterState,
  ExpectedSectionNode,
} from "./types";
import { EMPTY_FILTERS } from "./types";
import {
  buildNumbering,
  detectAnomalies,
  sortSections,
  filterSections,
  diffWithExpectedSections,
  flattenExpectedNodes,
  getVisibleSectionIds,
  getParentChain,
  hasChildren,
  ANOMALY_LABELS,
} from "./utils";

/* ═══════════════ Helpers ═══════════════ */

const CONFIDENCE_COLOR = (c: number) =>
  c >= 0.85 ? "text-green-700 bg-green-50" :
  c >= 0.6 ? "text-blue-700 bg-blue-50" :
  c >= 0.3 ? "text-amber-700 bg-amber-50" :
  "text-red-700 bg-red-50";

const STATUS_CLS: Record<string, string> = {
  validated: "bg-green-100 text-green-800",
  not_validated: "bg-gray-100 text-gray-600",
  requires_rework: "bg-red-100 text-red-800",
};

const STATUS_LABEL: Record<string, string> = {
  validated: "Подтверждён",
  not_validated: "Не подтверждён",
  requires_rework: "На доработку",
};

const SORT_LABELS: Record<SortKey, string> = {
  order: "По порядку",
  title: "По заголовку",
  level: "По уровню",
  structureStatus: "По статусу структуры",
  blockCount: "По кол-ву блоков",
};

const ANOMALY_ICON_CLS: Record<AnomalyType, string> = {
  empty: "text-amber-500",
  orphaned: "text-red-500",
  duplicate_title: "text-orange-500",
  short: "text-yellow-600",
};

/* ═══════════════ ContentBlockPanel ═══════════════ */

function ContentBlockPanel({ blocks }: { blocks: Section["contentBlocks"] }) {
  if (blocks.length === 0) {
    return (
      <p className="py-3 pl-10 text-xs italic text-gray-400">
        Контент отсутствует.
      </p>
    );
  }
  return (
    <div className="border-l-2 border-brand-200 bg-gray-50/60 py-2 pl-10 pr-4 space-y-2">
      {blocks.map((b) => {
        switch (b.type) {
          case "table":
          case "table_cell":
            return b.rawHtml ? (
              <div
                key={b.id}
                className="prose prose-sm max-w-none overflow-x-auto rounded border border-gray-200 bg-white p-2 text-xs"
                dangerouslySetInnerHTML={{ __html: b.rawHtml }}
              />
            ) : (
              <pre key={b.id} className="rounded border border-gray-200 bg-white p-2 text-xs whitespace-pre-wrap">
                {b.content}
              </pre>
            );
          case "footnote":
            return (
              <p key={b.id} className="text-xs italic text-gray-500">
                {b.content}
              </p>
            );
          case "list":
            return (
              <div key={b.id} className="text-xs text-gray-700 pl-4">
                {b.rawHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: b.rawHtml }} />
                ) : (
                  <p>{b.content}</p>
                )}
              </div>
            );
          case "image":
            return (
              <div key={b.id} className="flex items-center gap-2 rounded border border-gray-200 bg-white p-2 text-xs text-gray-400">
                [Изображение]
              </div>
            );
          default:
            return b.rawHtml ? (
              <div
                key={b.id}
                className="prose prose-sm max-w-none text-xs text-gray-700"
                dangerouslySetInnerHTML={{ __html: b.rawHtml }}
              />
            ) : (
              <p key={b.id} className="text-xs text-gray-700 leading-relaxed">
                {b.content}
              </p>
            );
        }
      })}
    </div>
  );
}

/* ═══════════════ ParsingDiffOverlay ═══════════════ */

type ParsingQuickFix =
  // extra → принять заголовок в эталон (создать ExpectedSection с anchor'ом из real-секции).
  | { kind: "accept_extra"; sectionId: string; sectionTitle: string; level: number }
  // extra → пометить как ложный заголовок (Section.isFalseHeading=true). Каскадно скрывает
  // секцию из diff Парсинга и Классификации.
  | { kind: "mark_false_heading"; sectionId: string; sectionTitle: string }
  // missing / orphaned → эксперт согласен, что записи в эталоне быть не должно (delete).
  | { kind: "remove_expected"; expectedSectionId: string; sectionTitle: string }
  // wrong_level → обновить level у существующего ExpectedSection.
  | { kind: "apply_level"; expectedSectionId: string; sectionTitle: string; newLevel: number }
  // orphaned → re-pin'нуть ExpectedSection на конкретную real-секцию.
  | { kind: "repin"; expectedSectionId: string; sectionTitle: string; realSectionId: string };

interface ParsingDiffOverlayProps {
  entries: DiffEntry[];
  sections: Section[];
  /** Иерархическая нумерация (как в дереве): sectionId → "1.2.3". Показывается
      в строке overlay для extra и wrong_level, чтобы при дубликатах title
      эксперт видел какая именно копия попала в diff. */
  numbering: Map<string, string>;
  onQuickFix: (fix: ParsingQuickFix) => void;
  onJumpToSection: (sectionId: string) => void;
  fixPending: boolean;
}

function ParsingDiffOverlay({
  entries,
  sections,
  numbering,
  onQuickFix,
  onJumpToSection,
  fixPending,
}: ParsingDiffOverlayProps) {
  // Resolve секции из entry: сначала по actualSectionId (точное совпадение,
  // важно для дубликатов title), потом fallback по title (для старых entries).
  const sectionById = useMemo(() => {
    const m = new Map<string, Section>();
    for (const s of sections) m.set(s.id, s);
    return m;
  }, [sections]);
  const titleToSection = useMemo(() => {
    const m = new Map<string, Section>();
    for (const s of sections) m.set(s.title.trim().toLowerCase(), s);
    return m;
  }, [sections]);
  const resolveSection = (e: DiffEntry): Section | undefined => {
    if (e.actualSectionId) {
      const byId = sectionById.get(e.actualSectionId);
      if (byId) return byId;
    }
    return titleToSection.get(e.sectionTitle.trim().toLowerCase());
  };

  // Локальный per-row выбор уровня для wrong_level — initial = expected.level.
  const [pendingLevels, setPendingLevels] = useState<Map<string, number>>(new Map());

  // Открытый pin-picker для orphaned-строки (по rowKey, чтобы попасть в нужную запись).
  const [repinTargetId, setRepinTargetId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
        Структура полностью совпадает с эталоном.
      </div>
    );
  }

  const missing = entries.filter((e) => e.type === "missing");
  const extra = entries.filter((e) => e.type === "extra");
  const wrongLevel = entries.filter((e) => e.type === "wrong_level");
  const orphaned = entries.filter((e) => e.type === "orphaned");

  const getRowKey = (e: DiffEntry, idx: number) => `${e.type}:${e.sectionTitle}:${idx}`;

  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-xs font-medium">
        <span className="rounded bg-red-100 px-2 py-1 text-red-700">Пропущено: {missing.length}</span>
        <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">Лишних: {extra.length}</span>
        <span className="rounded bg-blue-100 px-2 py-1 text-blue-700">Неверный уровень: {wrongLevel.length}</span>
        <span
          className="rounded bg-purple-100 px-2 py-1 text-purple-700"
          title="После re-parse автомэтч не нашёл подходящей секции — нужен re-pin"
        >
          Потеряны: {orphaned.length}
        </span>
      </div>

      <div className="max-h-80 overflow-y-auto space-y-1.5">
        {entries.map((e, i) => {
          const rowKey = getRowKey(e, i);
          const matchedSection = resolveSection(e);
          const sectionNumber = matchedSection ? numbering.get(matchedSection.id) : undefined;

          const borderBg =
            e.type === "missing"
              ? "border-red-200 bg-red-50"
              : e.type === "extra"
                ? "border-amber-200 bg-amber-50"
                : e.type === "wrong_level"
                  ? "border-blue-200 bg-blue-50"
                  : "border-purple-200 bg-purple-50";
          const labelColor =
            e.type === "missing"
              ? "text-red-700"
              : e.type === "extra"
                ? "text-amber-700"
                : e.type === "wrong_level"
                  ? "text-blue-700"
                  : "text-purple-700";
          const labelText =
            e.type === "missing"
              ? "Пропущено"
              : e.type === "extra"
                ? "Лишняя"
                : e.type === "wrong_level"
                  ? "Неверный уровень"
                  : "Потеряна (orphaned)";

          // Цепочка родителей для контекста (extra и wrong_level — берём из реальной
          // секции; missing — секции в документе нет, breadcrumb недоступен).
          const parentChain = matchedSection ? getParentChain(matchedSection.id, sections) : [];
          const parentBreadcrumb = parentChain.length > 0
            ? parentChain.map((p) => p.title || "(без названия)").join(" › ")
            : null;

          return (
            <div key={rowKey} className={`rounded-md border px-3 py-2 text-xs ${borderBg}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {parentBreadcrumb && (
                    <div className="mb-0.5 truncate text-[10px] text-gray-500" title={parentBreadcrumb}>
                      {parentBreadcrumb}
                    </div>
                  )}
                  <span className={`font-medium ${labelColor}`}>{labelText}</span>
                  {sectionNumber && (
                    <span className="ml-1 inline-block rounded bg-white px-1 font-mono text-[10px] text-gray-500" title="Номер секции в дереве (для дубликатов title)">
                      №{sectionNumber}
                    </span>
                  )}
                  <span className="ml-1 text-gray-900" title={e.sectionTitle}>
                    {e.sectionTitle}
                  </span>
                  {e.type === "wrong_level" && e.expected && e.actual && (
                    <div className="mt-0.5 text-gray-500">
                      ожидался L{e.expected.level}, получен L{e.actual.level}
                    </div>
                  )}
                  {e.type === "extra" && e.actual && (
                    <div className="mt-0.5 text-gray-500">
                      L{e.actual.level} в документе, нет в эталоне
                    </div>
                  )}
                  {e.type === "missing" && e.expected && (
                    <div className="mt-0.5 text-gray-500">
                      ожидался L{e.expected.level}, нет в документе
                    </div>
                  )}
                  {e.type === "orphaned" && e.expected && (
                    <div className="mt-0.5 text-gray-500">
                      L{e.expected.level} в эталоне, anchor не нашёл секцию после re-parse
                    </div>
                  )}
                </div>
                {matchedSection && (
                  <button
                    type="button"
                    onClick={() => onJumpToSection(matchedSection.id)}
                    className="shrink-0 rounded border border-gray-300 bg-white p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                    title="Перейти к строке в дереве"
                  >
                    <CornerDownRight size={12} />
                  </button>
                )}
              </div>

              {/* Кнопки действий — разные для разных типов */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {e.type === "extra" && matchedSection && (
                  <>
                    <button
                      type="button"
                      disabled={fixPending}
                      onClick={() =>
                        onQuickFix({
                          kind: "accept_extra",
                          sectionId: matchedSection.id,
                          sectionTitle: e.sectionTitle,
                          level: matchedSection.level,
                        })
                      }
                      className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      title="Создать ExpectedSection с anchor'ом из этой секции"
                    >
                      Принять в эталон
                    </button>
                    <button
                      type="button"
                      disabled={fixPending}
                      onClick={() =>
                        onQuickFix({
                          kind: "mark_false_heading",
                          sectionId: matchedSection.id,
                          sectionTitle: e.sectionTitle,
                        })
                      }
                      className="flex items-center gap-1 rounded bg-gray-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      title="Пометить секцию как ложный заголовок (исключить из всех diff)"
                    >
                      <EyeOff size={11} /> Не заголовок
                    </button>
                  </>
                )}

                {e.type === "missing" && e.expectedSectionId && (
                  <button
                    type="button"
                    disabled={fixPending}
                    onClick={() =>
                      onQuickFix({
                        kind: "remove_expected",
                        expectedSectionId: e.expectedSectionId!,
                        sectionTitle: e.sectionTitle,
                      })
                    }
                    className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    title="Удалить запись ExpectedSection"
                  >
                    Удалить из эталона
                  </button>
                )}

                {e.type === "orphaned" && e.expectedSectionId && (
                  <>
                    <button
                      type="button"
                      disabled={fixPending}
                      onClick={() => setRepinTargetId(rowKey)}
                      className="rounded bg-purple-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                      title="Привязать запись к реальной секции"
                    >
                      Восстановить anchor
                    </button>
                    <button
                      type="button"
                      disabled={fixPending}
                      onClick={() =>
                        onQuickFix({
                          kind: "remove_expected",
                          expectedSectionId: e.expectedSectionId!,
                          sectionTitle: e.sectionTitle,
                        })
                      }
                      className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      title="Удалить запись ExpectedSection"
                    >
                      Удалить из эталона
                    </button>
                  </>
                )}

                {e.type === "wrong_level" && e.actual && e.expected && e.expectedSectionId && (
                  <>
                    <select
                      value={pendingLevels.get(rowKey) ?? e.actual.level}
                      onChange={(ev) => {
                        const v = Number(ev.target.value);
                        setPendingLevels((prev) => {
                          const next = new Map(prev);
                          next.set(rowKey, v);
                          return next;
                        });
                      }}
                      className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs"
                    >
                      {[1, 2, 3, 4, 5, 6].map((lvl) => (
                        <option key={lvl} value={lvl}>
                          Уровень {lvl}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={fixPending}
                      onClick={() =>
                        onQuickFix({
                          kind: "apply_level",
                          expectedSectionId: e.expectedSectionId!,
                          sectionTitle: e.sectionTitle,
                          newLevel: pendingLevels.get(rowKey) ?? e.actual!.level,
                        })
                      }
                      className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      title="Обновить level у ExpectedSection"
                    >
                      Применить уровень в эталон
                    </button>
                  </>
                )}
              </div>

              {repinTargetId === rowKey && e.type === "orphaned" && e.expectedSectionId && (
                <PinPickerDialog
                  expectedTitle={e.sectionTitle}
                  sections={sections}
                  onCancel={() => setRepinTargetId(null)}
                  onPick={(realSectionId) => {
                    onQuickFix({
                      kind: "repin",
                      expectedSectionId: e.expectedSectionId!,
                      sectionTitle: e.sectionTitle,
                      realSectionId,
                    });
                    setRepinTargetId(null);
                  }}
                  isPending={fixPending}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════ PinPickerDialog ═══════════════ */

function PinPickerDialog({
  expectedTitle,
  sections,
  onCancel,
  onPick,
  isPending,
}: {
  expectedTitle: string;
  sections: Section[];
  onCancel: () => void;
  onPick: (realSectionId: string) => void;
  isPending: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Сначала «похожие» секции по нижнему регистру, потом остальные.
  const candidates = useMemo(() => {
    const needle = (filter || expectedTitle).trim().toLowerCase();
    if (!needle) return sections.filter((s) => !s.isFalseHeading);
    const scored = sections
      .filter((s) => !s.isFalseHeading)
      .map((s) => {
        const title = s.title.toLowerCase();
        const score = title.includes(needle)
          ? 2
          : title.split(/\s+/).some((w) => needle.includes(w))
            ? 1
            : 0;
        return { s, score };
      });
    scored.sort((a, b) => b.score - a.score || a.s.order - b.s.order);
    return scored.map((x) => x.s);
  }, [filter, expectedTitle, sections]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">Восстановить anchor</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-3 p-6">
          <p className="text-sm text-gray-600">
            Выберите секцию, к которой нужно привязать запись эталона{" "}
            <span className="font-medium">«{expectedTitle}»</span>.
          </p>
          <input
            type="text"
            value={filter}
            onChange={(ev) => setFilter(ev.target.value)}
            placeholder={`Фильтр (по умолчанию — ищет «${expectedTitle.slice(0, 40)}»)`}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <div className="max-h-72 overflow-y-auto rounded border border-gray-200 bg-white">
            {candidates.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs italic text-gray-400">
                Нет секций по фильтру.
              </p>
            ) : (
              candidates.slice(0, 200).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`flex w-full items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${
                    selectedId === s.id ? "bg-purple-50 ring-1 ring-purple-300" : ""
                  }`}
                >
                  <span className="font-mono text-[10px] text-gray-400">L{s.level}</span>
                  <span className="flex-1 truncate text-gray-700" title={s.title}>
                    {s.title || "(без названия)"}
                  </span>
                  <span className="text-[10px] text-gray-400">{s.contentBlocks.length} бл.</span>
                </button>
              ))
            )}
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={onCancel}
              disabled={isPending}
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              onClick={() => selectedId && onPick(selectedId)}
              disabled={!selectedId || isPending}
              className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {isPending ? <Loader2 size={14} className="animate-spin" /> : "Привязать"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ SourcePreviewPanel ═══════════════ */

function SourcePreviewPanel({
  sections,
  focusedSectionId,
}: {
  sections: Section[];
  focusedSectionId: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusedSectionId && containerRef.current) {
      const el = containerRef.current.querySelector(`[data-section-id="${focusedSectionId}"]`) as HTMLElement | null;
      if (el) {
        const container = containerRef.current;
        const elRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const scrollTarget = container.scrollTop + (elRect.top - containerRect.top) - 12;
        container.scrollTo({ top: scrollTarget, behavior: "smooth" });
      }
    }
  }, [focusedSectionId]);

  return (
    <div
      ref={containerRef}
      className="max-h-[600px] overflow-y-auto rounded-md border border-gray-200 bg-white p-4 sticky top-4"
    >
      {sections.map((s) => (
        <div
          key={s.id}
          data-section-id={s.id}
          className={`mb-4 ${focusedSectionId === s.id ? "ring-2 ring-brand-300 rounded-md p-2" : ""}`}
        >
          <h4
            className="font-semibold text-gray-900 mb-1"
            style={{ fontSize: `${Math.max(0.75, 1 - s.level * 0.1)}rem` }}
          >
            {s.title || "(без названия)"}
          </h4>
          {s.contentBlocks.map((b) =>
            b.rawHtml ? (
              <div
                key={b.id}
                className="prose prose-sm max-w-none text-xs mb-1"
                dangerouslySetInnerHTML={{ __html: b.rawHtml }}
              />
            ) : (
              <p key={b.id} className="text-xs text-gray-600 mb-1">
                {b.content}
              </p>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════ ParsingToolbar ═══════════════ */

function ParsingToolbar({
  sortKey,
  onSortChange,
  filters,
  onFiltersChange,
  selectedCount,
  totalCount,
  visibleCount,
  anomalyCount,
  onBulkValidate,
  onBulkRework,
  onClearSelection,
  onSelectAll,
  onExpandAll,
  onCollapseAll,
  showDiff,
  onToggleDiff,
  hasDiffData,
  showSource,
  onToggleSource,
  bulkPending,
  existingReworkComment,
  onOpenAddManual,
  onOpenInWord,
}: {
  sortKey: SortKey;
  onSortChange: (k: SortKey) => void;
  filters: FilterState;
  onFiltersChange: (f: FilterState) => void;
  selectedCount: number;
  totalCount: number;
  visibleCount: number;
  anomalyCount: number;
  onBulkValidate: () => void;
  onBulkRework: (comment?: string) => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  showDiff: boolean;
  onToggleDiff: () => void;
  hasDiffData: boolean;
  showSource: boolean;
  onToggleSource: () => void;
  bulkPending: boolean;
  /** Существующий structureComment одной из выделенных секций.
      Pre-fill в textarea чтобы annotator мог его поправить. */
  existingReworkComment?: string;
  /** Открыть модалку «добавить раздел вручную». Опционально — если не передано, кнопка скрыта. */
  onOpenAddManual?: () => void;
  /** Открыть документ в Word add-in (mode='parsing'). Опционально — если не передано, кнопка скрыта. */
  onOpenInWord?: () => void;
}) {
  return (
    <div className="space-y-3">
      {/* Row 1: Sort + Toggles + Summary */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <ChevronsUpDown size={14} className="text-gray-400" />
          <select
            value={sortKey}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
        </div>

        {/* Source toggle */}
        <button
          onClick={onToggleSource}
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
            showSource
              ? "border-brand-300 bg-brand-50 text-brand-700"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          <Columns2 size={12} /> Исходник
        </button>

        {/* Diff toggle */}
        <button
          onClick={onToggleDiff}
          disabled={!hasDiffData}
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors disabled:opacity-40 ${
            showDiff
              ? "border-blue-300 bg-blue-50 text-blue-700"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          <GitCompareArrows size={12} /> Diff с эталоном
        </button>

        {/* Expand / Collapse */}
        <button onClick={onExpandAll} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
          Развернуть все
        </button>
        <button onClick={onCollapseAll} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
          Свернуть все
        </button>

        {/* Add manual section */}
        {onOpenAddManual && (
          <button
            onClick={onOpenAddManual}
            className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
            title="Добавить раздел вручную (если парсер его пропустил)"
          >
            + Добавить раздел
          </button>
        )}

        {/* Open in Word add-in */}
        {onOpenInWord && (
          <button
            onClick={onOpenInWord}
            className="rounded border border-purple-300 bg-purple-50 px-2 py-1 text-xs text-purple-700 hover:bg-purple-100"
            title="Открыть документ в Word с подключённым add-in для разметки заголовков"
          >
            🪟 Открыть в Word
          </button>
        )}

        {/* Summary */}
        <span className="ml-auto text-xs text-gray-500">
          {visibleCount === totalCount
            ? `${totalCount} секций`
            : `${visibleCount} из ${totalCount}`}
          {anomalyCount > 0 && (
            <span className="ml-1 text-amber-600">, {anomalyCount} аномалий</span>
          )}
        </span>
      </div>

      {/* Row 2: Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={12} className="text-gray-400" />

        <select
          value={filters.structureStatus}
          onChange={(e) => onFiltersChange({ ...filters, structureStatus: e.target.value as FilterState["structureStatus"] })}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Структура: все</option>
          <option value="validated">Структура: подтверждён</option>
          <option value="not_validated">Структура: не подтверждён</option>
          <option value="requires_rework">Структура: на доработку</option>
        </select>

        <select
          value={filters.level}
          onChange={(e) => onFiltersChange({ ...filters, level: e.target.value as FilterState["level"] })}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Все уровни</option>
          <option value="1">Уровень 1</option>
          <option value="2">Уровень 2</option>
          <option value="3+">Уровень 3+</option>
        </select>

        <select
          value={filters.hasContent}
          onChange={(e) => onFiltersChange({ ...filters, hasContent: e.target.value as FilterState["hasContent"] })}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Контент: любой</option>
          <option value="yes">С контентом</option>
          <option value="no">Без контента</option>
        </select>

        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.anomaliesOnly}
            onChange={(e) => onFiltersChange({ ...filters, anomaliesOnly: e.target.checked })}
            className="rounded border-gray-300"
          />
          Только аномалии
        </label>

        {(filters.structureStatus || filters.level || filters.hasContent || filters.anomaliesOnly) && (
          <button
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="text-xs text-brand-600 hover:text-brand-700"
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Row 3: Bulk actions (shown when items selected) */}
      {selectedCount > 0 && (
        <BulkActionsBar
          selectedCount={selectedCount}
          onBulkValidate={onBulkValidate}
          onBulkRework={onBulkRework}
          onClearSelection={onClearSelection}
          onSelectAll={onSelectAll}
          bulkPending={bulkPending}
          existingReworkComment={existingReworkComment}
        />
      )}
    </div>
  );
}

function BulkActionsBar({
  selectedCount,
  onBulkValidate,
  onBulkRework,
  onClearSelection,
  onSelectAll,
  bulkPending,
  existingReworkComment,
}: {
  selectedCount: number;
  onBulkValidate: () => void;
  onBulkRework: (comment?: string) => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
  bulkPending: boolean;
  existingReworkComment?: string;
}) {
  const [showReworkDialog, setShowReworkDialog] = useState(false);
  const [reworkComment, setReworkComment] = useState("");

  // Pre-fill комментарий когда annotator открывает диалог: если у выделенных
  // секций уже есть structureComment (после прошлого «На доработку») —
  // показываем его, чтобы можно было поправить, а не вводить заново.
  useEffect(() => {
    if (showReworkDialog && existingReworkComment !== undefined) {
      setReworkComment(existingReworkComment ?? "");
    }
  }, [showReworkDialog, existingReworkComment]);

  return (
    <>
      <div className="flex items-center gap-3 rounded-md bg-brand-50 border border-brand-200 px-3 py-2">
        <span className="text-xs font-medium text-brand-700">
          Выбрано: {selectedCount}
        </span>
        <button
          onClick={onBulkValidate}
          disabled={bulkPending}
          className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          Подтвердить
        </button>
        <button
          onClick={() => setShowReworkDialog(true)}
          disabled={bulkPending}
          className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          На доработку
        </button>
        {bulkPending && <Loader2 size={14} className="animate-spin text-brand-500" />}
        <button
          onClick={onSelectAll}
          className="ml-auto rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
        >
          Выделить все
        </button>
        <button
          onClick={onClearSelection}
          className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
        >
          Снять выделение
        </button>
      </div>

      {showReworkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900">Отправить на доработку</h3>
              <button onClick={() => { setShowReworkDialog(false); setReworkComment(""); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                {selectedCount} {selectedCount === 1 ? "секция будет помечена" : "секций будут помечены"} как требующие доработки.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Комментарий <span className="text-gray-400 font-normal">(необязательно)</span>
                </label>
                <textarea
                  value={reworkComment}
                  onChange={(e) => setReworkComment(e.target.value)}
                  rows={3}
                  placeholder="Опишите, что именно нужно исправить..."
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setShowReworkDialog(false); setReworkComment(""); }}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  onClick={() => {
                    onBulkRework(reworkComment || undefined);
                    setShowReworkDialog(false);
                    setReworkComment("");
                  }}
                  disabled={bulkPending}
                  className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {bulkPending ? (
                    <span className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" /> Сохранение...
                    </span>
                  ) : (
                    "На доработку"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════ SectionTreeRow ═══════════════ */

function SectionTreeRow({
  section,
  numbering,
  anomalies,
  diffType,
  isParent,
  isCollapsed,
  isExpanded,
  isSelected,
  isFocused,
  onToggleCollapse,
  onToggleExpand,
  onToggleSelect,
  onToggleFalseHeading,
  onDeleteManual,
  falseHeadingPending,
  rowRef,
}: {
  section: Section;
  numbering: string;
  anomalies: AnomalyType[];
  diffType?: DiffEntry["type"];
  isParent: boolean;
  isCollapsed: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  onToggleCollapse: () => void;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onToggleFalseHeading: () => void;
  /** Опционально — для manual-секций показывает «удалить вручную добавленный раздел». */
  onDeleteManual?: () => void;
  falseHeadingPending: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
}) {
  const isFalse = section.isFalseHeading;
  const diffBg = isFalse
    ? "bg-gray-100/70"
    : diffType === "extra"
      ? "bg-amber-50/60"
      : diffType === "wrong_level"
        ? "bg-blue-50/60"
        : "";

  return (
    <div ref={rowRef}>
      <div
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors cursor-pointer
          ${isFocused ? "ring-2 ring-brand-400 ring-inset" : ""}
          ${anomalies.length > 0 && !diffBg ? "bg-amber-50/40" : diffBg}
          hover:bg-gray-100/60`}
        style={{ paddingLeft: `${section.level * 20 + 8}px` }}
        onClick={onToggleExpand}
      >
        {/* Checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className="shrink-0 text-gray-400 hover:text-brand-600"
        >
          {isSelected ? <CheckSquare size={15} className="text-brand-600" /> : <Square size={15} />}
        </button>

        {/* Collapse arrow for parents */}
        {isParent ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
            className="shrink-0 text-gray-400 hover:text-gray-700"
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <span className="w-[14px] shrink-0" />
        )}

        {/* Numbering */}
        <span className={`shrink-0 font-mono text-xs w-12 text-right ${isFalse ? "text-gray-300 line-through" : "text-gray-400"}`}>
          {numbering}
        </span>

        {/* Title */}
        <span
          className={`flex-1 min-w-0 truncate text-sm font-medium ${isFalse ? "text-gray-400 line-through" : "text-gray-900"}`}
          title={section.title || "(без названия)"}
        >
          {section.title || "(без названия)"}
        </span>

        {/* False-heading badge */}
        {isFalse && (
          <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700" title="Эксперт пометил как ложный заголовок — исключено из diff">
            Не заголовок
          </span>
        )}

        {/* Anomaly icons */}
        {anomalies.map((a) => (
          <span key={a} title={ANOMALY_LABELS[a]} className={`shrink-0 ${ANOMALY_ICON_CLS[a]}`}>
            <AlertTriangle size={13} />
          </span>
        ))}

        {/* Structure status badge */}
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLS[section.structureStatus] ?? ""}`}>
          {STATUS_LABEL[section.structureStatus] ?? section.structureStatus}
        </span>

        {/* Confidence */}
        {section.confidence != null && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_COLOR(section.confidence)}`}>
            {Math.round(section.confidence * 100)}%
          </span>
        )}

        {/* Block count */}
        <span className="shrink-0 text-[10px] text-gray-400 w-8 text-right">
          {section.contentBlocks.length} бл.
        </span>

        {/* Manual badge */}
        {section.isManual && (
          <span
            className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
            title="Раздел добавлен вручную"
          >
            ✱ manual
          </span>
        )}

        {/* Structure comment indicator */}
        {section.structureComment && (
          <span
            className="shrink-0 cursor-help text-[10px] text-amber-600"
            title={`Комментарий к доработке: ${section.structureComment}`}
          >
            💬
          </span>
        )}

        {/* Toggle false-heading */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFalseHeading(); }}
          disabled={falseHeadingPending}
          className="shrink-0 text-gray-400 hover:text-gray-700 disabled:opacity-40"
          title={isFalse ? "Восстановить как заголовок" : "Пометить как ложный заголовок"}
        >
          {isFalse ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>

        {/* Delete manual section */}
        {onDeleteManual && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteManual(); }}
            className="shrink-0 text-gray-400 hover:text-red-600"
            title="Удалить вручную добавленный раздел"
          >
            <X size={13} />
          </button>
        )}

        {/* Expand indicator */}
        <ChevronDown
          size={13}
          className={`shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </div>

      {/* Expanded content */}
      {isExpanded && <ContentBlockPanel blocks={section.contentBlocks} />}
    </div>
  );
}

/* ═══════════════ Main Component ═══════════════ */

export default function ParsingTreeViewer({
  versionId,
  goldenSampleId,
  stageKey = "parsing",
  stageStatusId,
}: {
  versionId: string;
  /** Опционально — нужен для quick-fix действий с expected_sections.
      Если не передан, доступна только пометка isFalseHeading на секции. */
  goldenSampleId?: string;
  stageKey?: string;
  /** ID `GoldenSampleStageStatus` для текущего (sample, stage). Нужен для
      `expectedSection.create` (parent-id записей). Если не передан,
      создание новых записей в эталон недоступно — diff и пометка
      false-heading работают, остальные действия отключены. */
  stageStatusId?: string;
}) {
  const q = trpc.document.getVersion.useQuery(
    { versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showSource, setShowSource] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const focusedRowRef = useRef<HTMLDivElement>(null);

  const rawSections = (q.data?.sections ?? []) as Section[];

  const anomalies = useMemo(() => detectAnomalies(rawSections), [rawSections]);

  const sorted = useMemo(() => sortSections(rawSections, sortKey), [rawSections, sortKey]);

  const filtered = useMemo(
    () => filterSections(sorted, filters, anomalies),
    [sorted, filters, anomalies],
  );

  const numbering = useMemo(() => buildNumbering(rawSections), [rawSections]);

  const visibleIds = useMemo(
    () => (sortKey === "order" ? getVisibleSectionIds(filtered, collapsedIds) : new Set(filtered.map((s) => s.id))),
    [filtered, collapsedIds, sortKey],
  );

  const visibleSections = useMemo(
    () => filtered.filter((s) => visibleIds.has(s.id)),
    [filtered, visibleIds],
  );

  // Pre-fill rework comment в bulk-диалоге: берём первый непустой
  // structureComment у выделенных секций. Аннотатор увидит существующий
  // комментарий и сможет его поправить, а не вводить заново.
  const existingReworkComment = useMemo(() => {
    for (const s of rawSections) {
      if (selectedIds.has(s.id) && s.structureComment) return s.structureComment;
    }
    return undefined;
  }, [rawSections, selectedIds]);

  const utils = trpc.useUtils();

  /* ── Manual sections ─────────────────────────────────────────────
   *
   * Аннотатор может добавить раздел вручную если парсер его пропустил.
   * Manual sections помечаются `isManual=true`, сохраняются при re-parse,
   * и могут быть удалены вручную. */
  const [showAddManualDialog, setShowAddManualDialog] = useState(false);
  const addManualMut = trpc.document.addManualSection.useMutation({
    onSuccess: () => utils.document.getVersion.invalidate({ versionId }),
  });
  const deleteManualMut = trpc.document.deleteManualSection.useMutation({
    onSuccess: () => utils.document.getVersion.invalidate({ versionId }),
  });

  /* ── Relational expected sections (PR #92 + PR E) ────────────────
   *
   * Читаем relational `ExpectedSection` через trpc.expectedSection.list.
   * Это полностью заменяет старый JSON expected_results.sections (legacy
   * остался у classification-viewer / annotate page до миграции).
   */
  const expectedQuery = trpc.expectedSection.list.useQuery(
    { goldenSampleId: goldenSampleId!, stage: stageKey },
    { enabled: !!goldenSampleId },
  );
  const expectedRoots = (expectedQuery.data ?? []) as ExpectedSectionNode[];

  const invalidateExpected = useCallback(() => {
    if (goldenSampleId) {
      utils.expectedSection.list.invalidate({ goldenSampleId, stage: stageKey });
    }
  }, [utils, goldenSampleId, stageKey]);

  const createExpectedMut = trpc.expectedSection.create.useMutation({
    onSuccess: invalidateExpected,
  });
  const updateExpectedMut = trpc.expectedSection.update.useMutation({
    onSuccess: invalidateExpected,
  });
  const deleteExpectedMut = trpc.expectedSection.delete.useMutation({
    onSuccess: invalidateExpected,
  });
  const pinExpectedMut = trpc.expectedSection.pin.useMutation({
    onSuccess: invalidateExpected,
  });

  const expectedFixPending =
    createExpectedMut.isPending ||
    updateExpectedMut.isPending ||
    deleteExpectedMut.isPending ||
    pinExpectedMut.isPending;

  const diffEntries = useMemo(
    () => (showDiff ? diffWithExpectedSections(rawSections, expectedRoots) : []),
    [showDiff, rawSections, expectedRoots],
  );

  // diffMap: realSectionId → diff type. Используется для подсветки строк в дереве.
  // orphaned не имеет real-секции, но может иметь её через `actualSectionId` (нет, не имеет).
  const diffMap = useMemo(() => {
    const m = new Map<string, DiffEntry["type"]>();
    for (const e of diffEntries) {
      if (e.actualSectionId) m.set(e.actualSectionId, e.type);
    }
    return m;
  }, [diffEntries]);

  const hasDiffData = expectedRoots.length > 0;

  const anomalyCount = anomalies.size;

  // Bulk status update
  const bulkStructureMutation = trpc.processing.bulkUpdateSectionStructureStatus.useMutation({
    onSuccess: () => {
      utils.document.getVersion.invalidate({ versionId });
      setSelectedIds(new Set());
    },
  });

  const bulkUpdate = useCallback(
    (status: "validated" | "requires_rework", structureComment?: string) => {
      // Защита от пустого выделения: иначе mutation отправит пустой массив, бэкенд молча
      // отработает 0 строк и кажется что «ничего не происходит».
      if (selectedIds.size === 0) return;
      bulkStructureMutation.mutate({
        sectionIds: Array.from(selectedIds),
        status,
        ...(structureComment ? { structureComment } : {}),
      });
    },
    [selectedIds, bulkStructureMutation],
  );

  // Optimistic update: меняем кеш `getVersion` сразу, до ответа сервера.
  // UI обновляется мгновенно (без 1-2 сек ожидания на сетевой round-trip + повторную
  // загрузку всех секций с блоками контента).
  //
  // Важно: invalidate делаем ТОЛЬКО на onError. Если ставить invalidate в onSettled —
  // при быстрых последовательных кликах refetch завершившейся мутации перезаписывает
  // кеш данными до того как сервер успел применить более поздние мутации (race),
  // и optimistic-патчи теряются. Поскольку наш patch идентичен ожидаемому результату
  // сервера, обновлять кеш с сервера не нужно — он уже корректен.
  const markFalseHeading = trpc.document.markSectionFalseHeading.useMutation({
    onMutate: async ({ sectionId, isFalseHeading }) => {
      await utils.document.getVersion.cancel({ versionId });
      const prev = utils.document.getVersion.getData({ versionId });
      utils.document.getVersion.setData({ versionId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          sections: old.sections.map((s) =>
            s.id === sectionId ? { ...s, isFalseHeading } : s,
          ),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.document.getVersion.setData({ versionId }, ctx.prev);
      // На ошибке синхронизируемся с реальным состоянием сервера.
      utils.document.getVersion.invalidate({ versionId });
    },
    onSuccess: (data) => {
      // Если сервер вернул cleanupSummary с удалёнными аннотациями или
      // expected_results entries — кеш goldenDataset.getSample (где живёт
      // expected) и evaluation/annotation listings могут быть устаревшими.
      // Инвалидируем точечно, без полного refetch getVersion (для него
      // optimistic-патч уже корректен).
      const summary = data?.cleanupSummary as
        | {
            deletedAnnotations?: number;
            clearedExpectedEntries?: number;
          }
        | undefined;
      if (
        summary &&
        ((summary.deletedAnnotations ?? 0) > 0 ||
          (summary.clearedExpectedEntries ?? 0) > 0) &&
        goldenSampleId
      ) {
        utils.goldenDataset.getSample.invalidate({ id: goldenSampleId });
      }
    },
  });

  // ── Confirm dialog state for destructive false-heading mark ──────────
  //
  // При transition false → true с непустым cascade cleanup (annotations
  // от пользователей или записи в эталоне) показываем модалку. Если
  // данных для удаления нет — мутация выполняется без диалога.
  type FalseHeadingConfirmState = {
    sectionId: string;
    sectionTitle: string;
    annotations: Array<{
      id: string;
      proposedZone: string | null;
      isQuestion: boolean;
      annotator: { id: string; name: string | null; email: string };
    }>;
    expectedEntries: number;
  };
  const [confirmFalseHeading, setConfirmFalseHeading] =
    useState<FalseHeadingConfirmState | null>(null);

  const requestMarkFalseHeading = useCallback(
    async (section: { id: string; title: string; isFalseHeading: boolean }) => {
      // Un-mark (true → false): не удаляем ничего, диалог не нужен.
      if (section.isFalseHeading) {
        markFalseHeading.mutate({ sectionId: section.id, isFalseHeading: false });
        return;
      }

      // Transition false → true: проверяем preview, чтобы решить нужен ли confirm.
      try {
        const preview = await utils.document.previewFalseHeadingCleanup.fetch({
          sectionId: section.id,
        });
        if (preview.annotations.length > 0 || preview.expectedEntries > 0) {
          setConfirmFalseHeading({
            sectionId: section.id,
            sectionTitle: section.title,
            annotations: preview.annotations,
            expectedEntries: preview.expectedEntries,
          });
          return;
        }
      } catch (err) {
        // Preview fetch failed — fail-safe: продолжаем без диалога. Сервер
        // в любом случае выполнит cleanup в транзакции.
        console.error("[markFalseHeading] preview failed, proceeding silently", err);
      }

      markFalseHeading.mutate({ sectionId: section.id, isFalseHeading: true });
    },
    [markFalseHeading, utils.document.previewFalseHeadingCleanup],
  );

  // Quick-fix для строки diff overlay. Логика по типу (relational):
  //  - accept_extra: создать ExpectedSection с anchor'ом из real-секции (incl. occurrenceIndex).
  //  - mark_false_heading: только Section.isFalseHeading=true (без правок эталона).
  //  - remove_expected: deleteExpected (для missing и orphaned).
  //  - apply_level: updateExpected({ patch: { level } }).
  //  - repin: pinExpected({ realSectionId }).
  const handleQuickFix = useCallback(
    (fix: ParsingQuickFix) => {
      if (fix.kind === "mark_false_heading") {
        // Тот же flow что и в дереве: preview → confirm если есть destructive
        // данные, иначе тихо.
        const sec = rawSections.find((s) => s.id === fix.sectionId);
        if (!sec) return;
        void requestMarkFalseHeading({
          id: fix.sectionId,
          title: sec.title,
          isFalseHeading: false, // overlay показывается только для не-false секций
        });
        return;
      }

      // Остальные действия требуют контекст golden-sample (правка эталона).
      if (!goldenSampleId) return;

      if (fix.kind === "accept_extra") {
        if (!stageStatusId) {
          // Нет stageStatusId — backend не сможет создать запись. Просто
          // no-op'аем (page.tsx должен передавать id; если нет — это баг
          // выше, но не должен крашить UI).
          return;
        }
        const sec = rawSections.find((s) => s.id === fix.sectionId);
        if (!sec) return;

        // Compute occurrenceIndex client-side: 0-based count of sections with
        // the same (case-insensitive, trimmed) title в порядке документа,
        // считая до этой секции.
        const norm = (t: string) => t.trim().toLowerCase();
        const target = norm(sec.title);
        let occurrenceIndex = 0;
        for (const s of rawSections) {
          if (norm(s.title) !== target) continue;
          if (s.id === sec.id) break;
          occurrenceIndex += 1;
        }

        const anchor = {
          paragraphIndex:
            typeof sec.sourceAnchor?.paragraphIndex === "number"
              ? sec.sourceAnchor.paragraphIndex
              : undefined,
          textSnippet: sec.sourceAnchor?.textSnippet || sec.title,
          occurrenceIndex,
          // contentBlockDigest не считаем на клиенте (нужен sha256 первых
          // 200 chars); follow-up `pin` пересчитает digest на сервере.
        };

        // Section.level и ExpectedSection.level — оба 1-based (см. headings
        // h1..h9 в parser.ts). Защищаемся от synthetic root (level=0):
        // если так — clamp к 1, чтобы Zod (`min(1)`) не отверг запрос.
        const apiLevel = Math.max(1, fix.level);

        // order: ставим в конец списка expected (упрощение, эксперт может
        // потом перетащить).
        const flatLen = flattenExpectedNodes(expectedRoots).length;

        createExpectedMut.mutate({
          stageStatusId,
          parentId: null,
          title: fix.sectionTitle,
          level: apiLevel,
          anchor,
          order: flatLen,
        });
        return;
      }

      if (fix.kind === "remove_expected") {
        deleteExpectedMut.mutate({ id: fix.expectedSectionId });
        return;
      }

      if (fix.kind === "apply_level") {
        // newLevel уже совпадает с Section.level (1-based). Clamp на min=1.
        const apiLevel = Math.max(1, fix.newLevel);
        updateExpectedMut.mutate({
          id: fix.expectedSectionId,
          patch: { level: apiLevel },
        });
        return;
      }

      if (fix.kind === "repin") {
        pinExpectedMut.mutate({
          expectedId: fix.expectedSectionId,
          realSectionId: fix.realSectionId,
        });
        return;
      }
    },
    [
      requestMarkFalseHeading,
      rawSections,
      goldenSampleId,
      stageStatusId,
      expectedRoots,
      createExpectedMut,
      updateExpectedMut,
      deleteExpectedMut,
      pinExpectedMut,
    ],
  );

  // Toggle helpers
  const toggleExpand = useCallback((id: string) => {
    setActiveSectionId(id);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const getDescendants = useCallback((id: string): string[] => {
    const idx = rawSections.findIndex((s) => s.id === id);
    if (idx < 0) return [];
    const parentLevel = rawSections[idx].level;
    const descendants: string[] = [];
    for (let i = idx + 1; i < rawSections.length; i++) {
      if (rawSections[i].level <= parentLevel) break;
      descendants.push(rawSections[i].id);
    }
    return descendants;
  }, [rawSections]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const descendants = getDescendants(id);
      if (next.has(id)) {
        next.delete(id);
        for (const d of descendants) next.delete(d);
      } else {
        next.add(id);
        for (const d of descendants) next.add(d);
      }
      return next;
    });
  }, [getDescendants]);

  const expandAll = useCallback(() => {
    setExpandedIds(new Set(visibleSections.map((s) => s.id)));
    setCollapsedIds(new Set());
  }, [visibleSections]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
    const parents = new Set<string>();
    for (const s of filtered) {
      if (hasChildren(s, filtered)) parents.add(s.id);
    }
    setCollapsedIds(parents);
  }, [filtered]);

  // Keyboard navigation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      const len = visibleSections.length;
      if (len === 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const nextIdx = Math.min(focusedIdx + 1, len - 1);
          setFocusedIdx(nextIdx);
          setActiveSectionId(visibleSections[nextIdx]?.id ?? null);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prevIdx = Math.max(focusedIdx - 1, 0);
          setFocusedIdx(prevIdx);
          setActiveSectionId(visibleSections[prevIdx]?.id ?? null);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          const s = visibleSections[focusedIdx];
          if (s && collapsedIds.has(s.id)) {
            toggleCollapse(s.id);
          } else if (s && !expandedIds.has(s.id)) {
            toggleExpand(s.id);
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const s = visibleSections[focusedIdx];
          if (s && expandedIds.has(s.id)) {
            toggleExpand(s.id);
          } else if (s && !collapsedIds.has(s.id) && hasChildren(s, filtered)) {
            toggleCollapse(s.id);
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          const s = visibleSections[focusedIdx];
          if (s) toggleExpand(s.id);
          break;
        }
        case " ": {
          e.preventDefault();
          const s = visibleSections[focusedIdx];
          if (s) toggleSelect(s.id);
          break;
        }
      }
    };

    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [visibleSections, focusedIdx, expandedIds, collapsedIds, filtered, toggleCollapse, toggleExpand, toggleSelect]);

  // Scroll focused row into view
  useEffect(() => {
    focusedRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIdx]);

  // Синхронизация focusedIdx с activeSectionId — нужна для onJumpToSection
  // из ParsingDiffOverlay: setActiveSectionId(id) сам по себе не двигает focusedIdx,
  // и scrollIntoView выше зависит от focusedIdx.
  useEffect(() => {
    if (!activeSectionId) return;
    const idx = visibleSections.findIndex((s) => s.id === activeSectionId);
    if (idx >= 0 && idx !== focusedIdx) {
      setFocusedIdx(idx);
    }
  }, [activeSectionId, visibleSections, focusedIdx]);

  /* ── Loading ── */
  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Загрузка структуры документа...</span>
      </div>
    );
  }

  /* ── Error ── */
  if (q.error) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-red-50 p-4 text-sm text-red-700">
        <AlertCircle size={16} /> {q.error.message}
      </div>
    );
  }

  /* ── Empty ── */
  if (rawSections.length === 0) {
    return (
      <p className="py-8 text-center text-sm italic text-gray-400">
        Секции не найдены. Документ ещё не разобран.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ParsingToolbar
        sortKey={sortKey}
        onSortChange={setSortKey}
        filters={filters}
        onFiltersChange={setFilters}
        selectedCount={selectedIds.size}
        totalCount={rawSections.length}
        visibleCount={visibleSections.length}
        anomalyCount={anomalyCount}
        onBulkValidate={() => bulkUpdate("validated")}
        onBulkRework={(comment) => bulkUpdate("requires_rework", comment)}
        onClearSelection={() => setSelectedIds(new Set())}
        onSelectAll={() => setSelectedIds(new Set(rawSections.map((s) => s.id)))}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        showDiff={showDiff}
        onToggleDiff={() => setShowDiff((p) => !p)}
        hasDiffData={hasDiffData}
        showSource={showSource}
        onToggleSource={() => setShowSource((p) => !p)}
        bulkPending={bulkStructureMutation.isPending}
        existingReworkComment={existingReworkComment}
        onOpenAddManual={() => setShowAddManualDialog(true)}
        onOpenInWord={async () => {
          try {
            await openInWord({
              mode: "parsing",
              docVersionId: versionId,
              goldenSampleId,
            });
          } catch (e) {
            alert(`Не удалось открыть в Word: ${(e as Error).message}`);
          }
        }}
      />

      {/* Diff results */}
      {showDiff && (
        <ParsingDiffOverlay
          entries={diffEntries}
          sections={rawSections}
          numbering={numbering}
          onQuickFix={handleQuickFix}
          onJumpToSection={(sectionId) => {
            // Сброс фильтров — иначе целевая строка может быть отфильтрована.
            setFilters(EMPTY_FILTERS);
            // Раскрываем все parent'ы.
            setCollapsedIds(new Set());
            // Активируем секцию — useEffect на activeSectionId сделает scrollIntoView.
            setActiveSectionId(sectionId);
            requestAnimationFrame(() => containerRef.current?.focus());
          }}
          fixPending={markFalseHeading.isPending || expectedFixPending}
        />
      )}

      {/* Keyboard hint */}
      <div className="flex items-center gap-1 text-[10px] text-gray-400">
        <Keyboard size={11} />
        <span>Стрелки — навигация, Enter — раскрыть контент, Пробел — выделить, ← / → — свернуть/развернуть дерево</span>
      </div>

      {/* Main content area */}
      <div className={`${showSource ? "grid grid-cols-2 gap-4" : ""}`}>
        {/* Tree */}
        <div
          ref={containerRef}
          tabIndex={0}
          className="max-h-[600px] overflow-y-auto rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
        >
          {visibleSections.length === 0 ? (
            <p className="py-8 text-center text-sm italic text-gray-400">
              Нет секций, соответствующих фильтрам.
            </p>
          ) : (
            <div className="py-1">
              {visibleSections.map((s, i) => (
                <SectionTreeRow
                  key={s.id}
                  section={s}
                  numbering={numbering.get(s.id) ?? ""}
                  anomalies={anomalies.get(s.id) ?? []}
                  diffType={diffMap.get(s.id)}
                  isParent={hasChildren(s, filtered)}
                  isCollapsed={collapsedIds.has(s.id)}
                  isExpanded={expandedIds.has(s.id)}
                  isSelected={selectedIds.has(s.id)}
                  isFocused={i === focusedIdx}
                  onToggleCollapse={() => toggleCollapse(s.id)}
                  onToggleExpand={() => toggleExpand(s.id)}
                  onToggleSelect={() => toggleSelect(s.id)}
                  onToggleFalseHeading={() =>
                    void requestMarkFalseHeading({
                      id: s.id,
                      title: s.title,
                      isFalseHeading: s.isFalseHeading,
                    })
                  }
                  onDeleteManual={
                    s.isManual
                      ? () => {
                          if (confirm(`Удалить вручную добавленный раздел "${s.title}"?`))
                            deleteManualMut.mutate({ sectionId: s.id });
                        }
                      : undefined
                  }
                  falseHeadingPending={markFalseHeading.isPending}
                  rowRef={i === focusedIdx ? focusedRowRef : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {/* Source panel */}
        {showSource && (
          <SourcePreviewPanel
            sections={rawSections}
            focusedSectionId={activeSectionId}
          />
        )}
      </div>

      {/* Add manual section modal */}
      {showAddManualDialog && (
        <AddManualSectionDialog
          versionId={versionId}
          sections={rawSections}
          onClose={() => setShowAddManualDialog(false)}
          onSubmit={async (input) => {
            await addManualMut.mutateAsync({ ...input, docVersionId: versionId });
            setShowAddManualDialog(false);
          }}
          isPending={addManualMut.isPending}
        />
      )}

      {/* Confirm dialog для destructive false-heading mark */}
      {confirmFalseHeading && (
        <ConfirmFalseHeadingDialog
          state={confirmFalseHeading}
          onCancel={() => setConfirmFalseHeading(null)}
          onConfirm={() => {
            markFalseHeading.mutate({
              sectionId: confirmFalseHeading.sectionId,
              isFalseHeading: true,
            });
            setConfirmFalseHeading(null);
          }}
          isPending={markFalseHeading.isPending}
        />
      )}
    </div>
  );
}

/* ═══════════════ ConfirmFalseHeadingDialog ═══════════════ */

function ConfirmFalseHeadingDialog({
  state,
  onCancel,
  onConfirm,
  isPending,
}: {
  state: {
    sectionTitle: string;
    annotations: Array<{
      id: string;
      annotator: { id: string; name: string | null; email: string };
    }>;
    expectedEntries: number;
  };
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  // Уникальные annotator'ы — для текста «удаление аннотаций от: ...»
  // Несколько аннотаций от одного annotator'а (по разным stage'ам) считаем один раз.
  const annotatorNames = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of state.annotations) {
      if (!seen.has(a.annotator.id)) {
        seen.set(a.annotator.id, a.annotator.name || a.annotator.email);
      }
    }
    return Array.from(seen.values());
  }, [state.annotations]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <AlertTriangle size={18} className="text-amber-500" />
            Пометить как ложный заголовок?
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-3 p-6 text-sm text-gray-700">
          <p>
            Секция <span className="font-medium">«{state.sectionTitle}»</span> будет
            помечена как ложный заголовок. Это действие приведёт к необратимому
            удалению связанных данных:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {state.annotations.length > 0 && (
              <li>
                <span className="font-medium">{state.annotations.length}</span>{" "}
                {state.annotations.length === 1 ? "аннотация" : "аннотаций"} от
                пользователей: {annotatorNames.join(", ")}
              </li>
            )}
            {state.expectedEntries > 0 && (
              <li>
                <span className="font-medium">{state.expectedEntries}</span>{" "}
                {state.expectedEntries === 1 ? "запись" : "записей"} в эталонных
                наборах (expected_results)
              </li>
            )}
            <li>Привязка секции к зоне (классификация будет очищена)</li>
          </ul>
          <p className="text-xs text-gray-500">
            Восстановить будет нельзя. Если позже снять пометку «ложный заголовок»,
            классификация и аннотации не вернутся автоматически.
          </p>
        </div>
        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Удаление...
              </span>
            ) : (
              "Подтвердить и удалить"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ AddManualSectionDialog ═══════════════ */

function AddManualSectionDialog({
  sections,
  onClose,
  onSubmit,
  isPending,
}: {
  versionId: string;
  sections: Section[];
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    level: number;
    paragraphIndex: number;
    textSnippet: string;
    afterSectionId?: string;
    contentBlockId?: string;
  }) => Promise<void>;
  isPending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState(2);
  const [anchorMode, setAnchorMode] = useState<"after-section" | "content-block">("after-section");
  const [afterSectionId, setAfterSectionId] = useState<string>("");
  const [contentBlockId, setContentBlockId] = useState<string>("");

  // Список content blocks с превью текста (для anchor-mode "content-block")
  const allBlocks = useMemo(() => {
    const out: Array<{ id: string; sectionTitle: string; content: string; index: number }> = [];
    let idx = 0;
    for (const s of sections) {
      for (const b of s.contentBlocks) {
        out.push({
          id: b.id,
          sectionTitle: s.title,
          content: b.content.slice(0, 120),
          index: idx++,
        });
      }
    }
    return out;
  }, [sections]);

  const canSubmit = title.trim().length > 0 && (anchorMode === "after-section" || contentBlockId);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    let paragraphIndex = 0;
    let textSnippet = title.trim();
    let resolvedAfterSectionId: string | undefined;

    if (anchorMode === "after-section" && afterSectionId) {
      // Поставить раздел сразу после выбранного. paragraphIndex берём от
      // конца блоков выбранного раздела (если есть) либо +1 от него.
      const after = sections.find((s) => s.id === afterSectionId);
      const lastBlockText = after?.contentBlocks.at(-1)?.content ?? after?.title ?? "";
      paragraphIndex = (after?.sourceAnchor?.paragraphIndex ?? 0) + 1;
      textSnippet = lastBlockText.slice(0, 200);
      resolvedAfterSectionId = afterSectionId;
    } else if (anchorMode === "content-block" && contentBlockId) {
      const blk = allBlocks.find((b) => b.id === contentBlockId);
      paragraphIndex = blk?.index ?? 0;
      textSnippet = blk?.content ?? title.trim();
    }

    await onSubmit({
      title: title.trim(),
      level,
      paragraphIndex,
      textSnippet,
      afterSectionId: resolvedAfterSectionId,
      contentBlockId: anchorMode === "content-block" ? contentBlockId : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">Добавить раздел вручную</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Название раздела</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например, «Введение» или «Цели исследования»"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Уровень</label>
            <select
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {[1, 2, 3, 4, 5].map((l) => (
                <option key={l} value={l}>
                  Уровень {l}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Привязка к месту в документе</label>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={anchorMode === "after-section"}
                  onChange={() => setAnchorMode("after-section")}
                />
                <span>После раздела:</span>
                <select
                  value={afterSectionId}
                  onChange={(e) => setAfterSectionId(e.target.value)}
                  disabled={anchorMode !== "after-section"}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
                >
                  <option value="">— выбрать —</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {`L${s.level} `}{s.title.slice(0, 60)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  checked={anchorMode === "content-block"}
                  onChange={() => setAnchorMode("content-block")}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <span>На блоке контента:</span>
                  <select
                    value={contentBlockId}
                    onChange={(e) => setContentBlockId(e.target.value)}
                    disabled={anchorMode !== "content-block"}
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="">— выбрать блок —</option>
                    {allBlocks.slice(0, 200).map((b) => (
                      <option key={b.id} value={b.id}>
                        [{b.index}] {b.content.slice(0, 80)}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={isPending}
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || isPending}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? <Loader2 size={14} className="animate-spin" /> : "Добавить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
