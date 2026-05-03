"use client";

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { trpc } from "@/lib/trpc";
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
} from "./types";
import { EMPTY_FILTERS } from "./types";
import {
  buildNumbering,
  detectAnomalies,
  sortSections,
  filterSections,
  diffWithExpected,
  getVisibleSectionIds,
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
  // extra → принять заголовок в эталон (добавить запись в expected.sections)
  | { kind: "accept_extra"; sectionId: string; sectionTitle: string; level: number }
  // extra → пометить как ложный заголовок (Section.isFalseHeading=true). Каскадно скрывает
  // секцию из diff Парсинга и Классификации.
  | { kind: "mark_false_heading"; sectionId: string; sectionTitle: string }
  // missing → эксперт согласен, что в эталоне этой записи быть не должно
  | { kind: "remove_missing"; sectionTitle: string }
  // wrong_level → синхронизировать уровень в эталоне с фактическим (правим эталон, не секцию)
  | { kind: "apply_level"; sectionTitle: string; newLevel: number };

interface ParsingDiffOverlayProps {
  entries: DiffEntry[];
  sections: Section[];
  onQuickFix: (fix: ParsingQuickFix) => void;
  onJumpToSection: (sectionId: string) => void;
  fixPending: boolean;
}

function ParsingDiffOverlay({
  entries,
  sections,
  onQuickFix,
  onJumpToSection,
  fixPending,
}: ParsingDiffOverlayProps) {
  const titleToSection = useMemo(() => {
    const m = new Map<string, Section>();
    for (const s of sections) m.set(s.title.trim().toLowerCase(), s);
    return m;
  }, [sections]);

  // Локальный per-row выбор уровня для wrong_level — initial = expected.level.
  const [pendingLevels, setPendingLevels] = useState<Map<string, number>>(new Map());

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

  const getRowKey = (e: DiffEntry, idx: number) => `${e.type}:${e.sectionTitle}:${idx}`;

  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-xs font-medium">
        <span className="rounded bg-red-100 px-2 py-1 text-red-700">Пропущено: {missing.length}</span>
        <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">Лишних: {extra.length}</span>
        <span className="rounded bg-blue-100 px-2 py-1 text-blue-700">Неверный уровень: {wrongLevel.length}</span>
      </div>

      <div className="max-h-80 overflow-y-auto space-y-1.5">
        {entries.map((e, i) => {
          const rowKey = getRowKey(e, i);
          const matchedSection = titleToSection.get(e.sectionTitle.trim().toLowerCase());

          const borderBg =
            e.type === "missing"
              ? "border-red-200 bg-red-50"
              : e.type === "extra"
                ? "border-amber-200 bg-amber-50"
                : "border-blue-200 bg-blue-50";
          const labelColor =
            e.type === "missing"
              ? "text-red-700"
              : e.type === "extra"
                ? "text-amber-700"
                : "text-blue-700";
          const labelText =
            e.type === "missing" ? "Пропущено" : e.type === "extra" ? "Лишняя" : "Неверный уровень";

          return (
            <div key={rowKey} className={`rounded-md border px-3 py-2 text-xs ${borderBg}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <span className={`font-medium ${labelColor}`}>{labelText}</span>
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
                      onClick={() =>
                        onQuickFix({
                          kind: "accept_extra",
                          sectionId: matchedSection.id,
                          sectionTitle: e.sectionTitle,
                          level: matchedSection.level,
                        })
                      }
                      disabled={fixPending}
                      className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      title="Добавить запись в expected_results"
                    >
                      Принять в эталон
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onQuickFix({
                          kind: "mark_false_heading",
                          sectionId: matchedSection.id,
                          sectionTitle: e.sectionTitle,
                        })
                      }
                      disabled={fixPending}
                      className="flex items-center gap-1 rounded bg-gray-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      title="Пометить секцию как ложный заголовок (исключить из всех diff)"
                    >
                      <EyeOff size={11} /> Не заголовок
                    </button>
                  </>
                )}

                {e.type === "missing" && (
                  <button
                    type="button"
                    onClick={() => onQuickFix({ kind: "remove_missing", sectionTitle: e.sectionTitle })}
                    disabled={fixPending}
                    className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    title="Удалить запись из expected_results"
                  >
                    Удалить из эталона
                  </button>
                )}

                {e.type === "wrong_level" && e.actual && e.expected && (
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
                      disabled={fixPending}
                    >
                      {[0, 1, 2, 3, 4, 5].map((lvl) => (
                        <option key={lvl} value={lvl}>
                          Уровень {lvl + 1}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        onQuickFix({
                          kind: "apply_level",
                          sectionTitle: e.sectionTitle,
                          newLevel: pendingLevels.get(rowKey) ?? e.actual!.level,
                        })
                      }
                      disabled={fixPending}
                      className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      title="Обновить уровень в expected_results"
                    >
                      Применить уровень в эталон
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
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
}: {
  selectedCount: number;
  onBulkValidate: () => void;
  onBulkRework: (comment?: string) => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
  bulkPending: boolean;
}) {
  const [showReworkDialog, setShowReworkDialog] = useState(false);
  const [reworkComment, setReworkComment] = useState("");

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

        {/* Toggle false-heading */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFalseHeading(); }}
          disabled={falseHeadingPending}
          className="shrink-0 text-gray-400 hover:text-gray-700 disabled:opacity-40"
          title={isFalse ? "Восстановить как заголовок" : "Пометить как ложный заголовок"}
        >
          {isFalse ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>

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
  expectedResults,
  goldenSampleId,
  stageKey = "parsing",
  stageStatus = "draft",
}: {
  versionId: string;
  expectedResults?: unknown;
  /** Опционально — нужен для quick-fix действий с expected_results JSON.
      Если не передан, доступна только пометка isFalseHeading на секции. */
  goldenSampleId?: string;
  stageKey?: string;
  stageStatus?: string;
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

  const diffEntries = useMemo(
    () => (showDiff ? diffWithExpected(rawSections, expectedResults) : []),
    [showDiff, rawSections, expectedResults],
  );

  const diffMap = useMemo(() => {
    const m = new Map<string, DiffEntry["type"]>();
    for (const e of diffEntries) {
      const sec = rawSections.find((s) => s.title.trim().toLowerCase() === e.sectionTitle.trim().toLowerCase());
      if (sec) m.set(sec.id, e.type);
    }
    return m;
  }, [diffEntries, rawSections]);

  const hasDiffData = !!expectedResults && typeof expectedResults === "object" &&
    Array.isArray((expectedResults as Record<string, unknown>).sections);

  const anomalyCount = anomalies.size;

  // Bulk status update
  const utils = trpc.useUtils();
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

  const markFalseHeading = trpc.document.markSectionFalseHeading.useMutation({
    onSuccess: () => {
      utils.document.getVersion.invalidate({ versionId });
    },
  });

  const updateExpected = trpc.goldenDataset.updateStageStatus.useMutation({
    onSuccess: () => {
      if (goldenSampleId) {
        utils.goldenDataset.getSample.invalidate({ id: goldenSampleId });
      }
    },
  });

  // Quick-fix для строки diff overlay. Логика по типу:
  //  - accept_extra: добавить запись в expected.sections (берём level из секции)
  //  - mark_false_heading: только Section.isFalseHeading=true (без правок эталона)
  //  - remove_missing: убрать запись из expected.sections
  //  - apply_level: обновить level у существующей записи в expected.sections
  const handleQuickFix = useCallback(
    (fix: ParsingQuickFix) => {
      if (fix.kind === "mark_false_heading") {
        markFalseHeading.mutate({ sectionId: fix.sectionId, isFalseHeading: true });
        return;
      }

      // Остальные действия требуют контекст golden-sample (правка эталона).
      if (!goldenSampleId) return;

      const current = (expectedResults as { sections?: Array<Record<string, unknown>> } | undefined) ?? {};
      const sectionsArr = Array.isArray(current.sections) ? [...current.sections] : [];

      const findIdx = (title: string) => {
        const lower = title.trim().toLowerCase();
        return sectionsArr.findIndex(
          (s) => String(s.title ?? "").trim().toLowerCase() === lower,
        );
      };

      let nextSections: Array<Record<string, unknown>> = sectionsArr;
      if (fix.kind === "accept_extra") {
        const idx = findIdx(fix.sectionTitle);
        if (idx >= 0) {
          nextSections = sectionsArr.map((s, i) =>
            i === idx ? { ...s, title: fix.sectionTitle, level: fix.level } : s,
          );
        } else {
          nextSections = [...sectionsArr, { title: fix.sectionTitle, level: fix.level }];
        }
      } else if (fix.kind === "remove_missing") {
        const idx = findIdx(fix.sectionTitle);
        if (idx < 0) return;
        nextSections = sectionsArr.filter((_, i) => i !== idx);
      } else if (fix.kind === "apply_level") {
        const idx = findIdx(fix.sectionTitle);
        if (idx < 0) return;
        nextSections = sectionsArr.map((s, i) =>
          i === idx ? { ...s, level: fix.newLevel } : s,
        );
      }

      updateExpected.mutate({
        goldenSampleId,
        stage: stageKey,
        status: (stageStatus === "not_set" ? "draft" : stageStatus) as
          | "draft"
          | "in_review"
          | "approved",
        expectedResults: { ...current, sections: nextSections },
      });
    },
    [markFalseHeading, updateExpected, expectedResults, goldenSampleId, stageKey, stageStatus],
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
      />

      {/* Diff results */}
      {showDiff && (
        <ParsingDiffOverlay
          entries={diffEntries}
          sections={rawSections}
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
          fixPending={markFalseHeading.isPending || updateExpected.isPending}
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
                    markFalseHeading.mutate({ sectionId: s.id, isFalseHeading: !s.isFalseHeading })
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
    </div>
  );
}
