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
  ExpectedSectionNode,
} from "./types";
import { EMPTY_FILTERS } from "./types";
import {
  buildNumbering,
  detectAnomalies,
  sortSections,
  filterSections,
  diffWithExpectedSections,
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
  // extra → принять заголовок в эталон. На relational схеме это создание новой
  // ExpectedSection с anchor от реальной секции.
  | { kind: "accept_extra"; sectionId: string; sectionTitle: string; level: number }
  // extra → пометить как ложный заголовок (Section.isFalseHeading=true). Каскадно скрывает
  // секцию из diff Парсинга и Классификации.
  | { kind: "mark_false_heading"; sectionId: string; sectionTitle: string }
  // orphaned/missing → удалить запись эталона (эксперт согласен убрать).
  | { kind: "delete_expected"; expectedSectionId: string; sectionTitle: string }
  // wrong_level → обновить level у существующей ExpectedSection.
  | { kind: "apply_level"; expectedSectionId: string; sectionTitle: string; newLevel: number }
  // orphaned → перепривязать ExpectedSection к выбранной реальной секции.
  | { kind: "pin_to_real"; expectedSectionId: string; realSectionId: string };

interface ParsingDiffOverlayProps {
  entries: DiffEntry[];
  sections: Section[];
  /** Иерархическая нумерация (как в дереве): sectionId → "1.2.3". Показывается
      в строке overlay для extra и wrong_level, чтобы при дубликатах title
      эксперт видел какая именно копия попала в diff. */
  numbering: Map<string, string>;
  onQuickFix: (fix: ParsingQuickFix) => void;
  onJumpToSection: (sectionId: string) => void;
  /** Открыть picker для повторной привязки orphaned ExpectedSection к
      реальной секции. Picker — отдельный модал в parent компоненте. */
  onOpenPinPicker: (expectedSectionId: string, sectionTitle: string) => void;
  fixPending: boolean;
}

function ParsingDiffOverlay({
  entries,
  sections,
  numbering,
  onQuickFix,
  onJumpToSection,
  onOpenPinPicker,
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
      <div className="flex flex-wrap gap-3 text-xs font-medium">
        {missing.length > 0 && (
          <span className="rounded bg-red-100 px-2 py-1 text-red-700">Пропущено: {missing.length}</span>
        )}
        <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">Лишних: {extra.length}</span>
        <span className="rounded bg-blue-100 px-2 py-1 text-blue-700">Неверный уровень: {wrongLevel.length}</span>
        <span className="rounded bg-purple-100 px-2 py-1 text-purple-700" title="Эталон существует, но парсер больше не нашёл соответствующую секцию">
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
                : e.type === "orphaned"
                  ? "border-purple-200 bg-purple-50"
                  : "border-blue-200 bg-blue-50";
          const labelColor =
            e.type === "missing"
              ? "text-red-700"
              : e.type === "extra"
                ? "text-amber-700"
                : e.type === "orphaned"
                  ? "text-purple-700"
                  : "text-blue-700";
          const labelText =
            e.type === "missing"
              ? "Пропущено"
              : e.type === "extra"
                ? "Лишняя"
                : e.type === "orphaned"
                  ? "Потеряна"
                  : "Неверный уровень";

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
                  {e.type === "orphaned" && (
                    <div className="mt-0.5 text-gray-500">
                      ожидался L{e.expected?.level ?? "?"}; парсер не нашёл секцию после relink
                      {e.expectedAnchor?.paragraphIndex != null && (
                        <span className="ml-1 font-mono text-[10px] text-gray-400">
                          (anchor ¶{e.expectedAnchor.paragraphIndex})
                        </span>
                      )}
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
                    onClick={() =>
                      onQuickFix({
                        kind: "delete_expected",
                        expectedSectionId: e.expectedSectionId!,
                        sectionTitle: e.sectionTitle,
                      })
                    }
                    className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700"
                    title="Удалить запись из эталона"
                  >
                    Удалить из эталона
                  </button>
                )}

                {e.type === "orphaned" && e.expectedSectionId && (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpenPinPicker(e.expectedSectionId!, e.sectionTitle)}
                      disabled={fixPending}
                      className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      title="Выбрать секцию в дереве, к которой привязать эталон"
                    >
                      Восстановить anchor
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onQuickFix({
                          kind: "delete_expected",
                          expectedSectionId: e.expectedSectionId!,
                          sectionTitle: e.sectionTitle,
                        })
                      }
                      disabled={fixPending}
                      className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      title="Удалить эталонную запись (если эксперт согласен, что её быть не должно)"
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
                          expectedSectionId: e.expectedSectionId!,
                          sectionTitle: e.sectionTitle,
                          newLevel: pendingLevels.get(rowKey) ?? e.actual!.level,
                        })
                      }
                      className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      title="Обновить уровень в эталоне"
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
  existingReworkComment,
  onOpenAddManual,
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
  // `stageStatus` сохранён в API ради обратной совместимости с page.tsx — на
  // relational endpoint он больше не нужен (мутации эталона не меняют статус
  // GoldenSampleStageStatus). Префикс _ — чтобы ESLint не жаловался на unused.
  stageStatus: _stageStatus = "draft",
}: {
  versionId: string;
  /** Опционально — нужен для quick-fix действий над эталоном. Если не передан,
      diff показывается только в режиме просмотра, без mutate-кнопок. */
  goldenSampleId?: string;
  stageKey?: string;
  stageStatus?: string;
}) {
  const q = trpc.document.getVersion.useQuery(
    { versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );

  // Relational expected sections: tree-shaped result from `expectedSection.list`.
  // Запрос enabled только когда есть goldenSampleId — без него diff недоступен.
  const expectedQuery = trpc.expectedSection.list.useQuery(
    { goldenSampleId: goldenSampleId ?? "", stage: stageKey },
    {
      enabled: !!goldenSampleId,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );
  const expectedSections = (expectedQuery.data ?? []) as ExpectedSectionNode[];

  // Получаем stageStatusId через getSample — нужен для `expectedSection.create`
  // (создание новой записи в эталоне). page.tsx уже его запрашивает, react-query
  // вернёт из кеша.
  const sampleQuery = trpc.goldenDataset.getSample.useQuery(
    { id: goldenSampleId ?? "" },
    {
      enabled: !!goldenSampleId,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );
  const stageStatusId = useMemo(() => {
    if (!sampleQuery.data) return null;
    return (
      sampleQuery.data.stageStatuses.find((ss) => ss.stage === stageKey)?.id ??
      null
    );
  }, [sampleQuery.data, stageKey]);

  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showSource, setShowSource] = useState(false);
  // State для pin-picker: модалка для перепривязки orphaned ExpectedSection
  // к выбранной реальной секции в дереве. null — модалка закрыта.
  const [pinPickerState, setPinPickerState] = useState<
    { expectedSectionId: string; sectionTitle: string } | null
  >(null);

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

  const diffEntries = useMemo(
    () => (showDiff ? diffWithExpectedSections(rawSections, expectedSections) : []),
    [showDiff, rawSections, expectedSections],
  );

  // diffMap — sectionId → DiffEntry.type. Для extra/wrong_level используем
  // actualSectionId (точный id), а не title-fallback (он плох для дубликатов).
  // orphaned не имеет real section, поэтому не попадает в map (и так корректно
  // не подсвечивает ничего в дереве).
  const diffMap = useMemo(() => {
    const m = new Map<string, DiffEntry["type"]>();
    for (const e of diffEntries) {
      if (e.actualSectionId) m.set(e.actualSectionId, e.type);
    }
    return m;
  }, [diffEntries]);

  const hasDiffData = expectedSections.length > 0;

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
  });

  // Relational expected mutations. После каждой — invalidate `expectedSection.list`
  // для goldenSampleId/stageKey, чтобы overlay пересобрался с актуальным деревом.
  // Optimistic-update сейчас не делаем — мутации редкие (1-2 клика подряд) и
  // serverside-validate'нные (parentId, level и пр.); консистентность важнее
  // чем мгновенная отрисовка. При необходимости можно будет добавить позднее.
  const invalidateExpectedQuery = useCallback(() => {
    if (!goldenSampleId) return;
    utils.expectedSection.list.invalidate({ goldenSampleId, stage: stageKey });
  }, [utils, goldenSampleId, stageKey]);

  const createExpected = trpc.expectedSection.create.useMutation({
    onSuccess: invalidateExpectedQuery,
  });
  const updateExpectedMut = trpc.expectedSection.update.useMutation({
    onSuccess: invalidateExpectedQuery,
  });
  const deleteExpectedMut = trpc.expectedSection.delete.useMutation({
    onSuccess: invalidateExpectedQuery,
  });
  const pinExpectedMut = trpc.expectedSection.pin.useMutation({
    onSuccess: invalidateExpectedQuery,
  });

  /**
   * Quick-fix для строки diff overlay. Маппинг на relational endpoint:
   *  - mark_false_heading: только Section.isFalseHeading=true (без правок эталона).
   *  - accept_extra:       create ExpectedSection с anchor от реальной секции
   *                        (paragraphIndex/textSnippet берутся из sourceAnchor;
   *                        сервер дополняет occurrenceIndex и digest при `pin`,
   *                        здесь же создаём + сразу pin'им к real section).
   *  - delete_expected:    delete (для missing/orphaned).
   *  - apply_level:        update level (для wrong_level).
   *  - pin_to_real:        pin к выбранной секции (для orphaned, через picker).
   */
  const handleQuickFix = useCallback(
    (fix: ParsingQuickFix) => {
      if (fix.kind === "mark_false_heading") {
        markFalseHeading.mutate({ sectionId: fix.sectionId, isFalseHeading: true });
        return;
      }

      if (!goldenSampleId) return;

      if (fix.kind === "accept_extra") {
        if (!stageStatusId) return; // sample/stage ещё не загрузились
        const realSection = rawSections.find((s) => s.id === fix.sectionId);
        const anchor = {
          paragraphIndex: realSection?.sourceAnchor?.paragraphIndex,
          textSnippet:
            realSection?.sourceAnchor?.textSnippet || fix.sectionTitle,
        };
        // Берём максимальный order среди корней + 1, чтобы новая запись
        // оказалась в конце. Лучшее место — после current relink, но это
        // выходит за рамки PR E (TODO: smart-insert по paragraphIndex).
        const maxRootOrder = expectedSections.reduce(
          (m, s) => Math.max(m, s.order),
          -1,
        );
        createExpected.mutate(
          {
            stageStatusId,
            parentId: null,
            title: fix.sectionTitle,
            level: fix.level,
            anchor,
            order: maxRootOrder + 1,
          },
          {
            onSuccess: (created) => {
              // Сразу pin'им новую запись к реальной секции — сервер досчитает
              // occurrenceIndex и contentBlockDigest, чтобы re-parse её нашёл.
              pinExpectedMut.mutate({
                expectedId: created.id,
                realSectionId: fix.sectionId,
              });
            },
          },
        );
        return;
      }

      if (fix.kind === "delete_expected") {
        deleteExpectedMut.mutate({ id: fix.expectedSectionId });
        return;
      }

      if (fix.kind === "apply_level") {
        updateExpectedMut.mutate({
          id: fix.expectedSectionId,
          patch: { level: fix.newLevel },
        });
        return;
      }

      if (fix.kind === "pin_to_real") {
        pinExpectedMut.mutate({
          expectedId: fix.expectedSectionId,
          realSectionId: fix.realSectionId,
        });
        return;
      }
    },
    [
      markFalseHeading,
      goldenSampleId,
      stageStatusId,
      rawSections,
      expectedSections,
      createExpected,
      pinExpectedMut,
      deleteExpectedMut,
      updateExpectedMut,
    ],
  );

  // `fixPending` — флаг для дизейбла кнопок overlay пока идёт любая мутация.
  const anyFixPending =
    markFalseHeading.isPending ||
    createExpected.isPending ||
    updateExpectedMut.isPending ||
    deleteExpectedMut.isPending ||
    pinExpectedMut.isPending;

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
          onOpenPinPicker={(expectedSectionId, sectionTitle) =>
            setPinPickerState({ expectedSectionId, sectionTitle })
          }
          fixPending={anyFixPending}
        />
      )}

      {/* Pin picker — для orphaned: эксперт выбирает реальную секцию,
          к которой надо привязать ExpectedSection. */}
      {pinPickerState && (
        <PinPickerDialog
          sections={rawSections}
          numbering={numbering}
          expectedTitle={pinPickerState.sectionTitle}
          onClose={() => setPinPickerState(null)}
          onPick={(realSectionId) => {
            handleQuickFix({
              kind: "pin_to_real",
              expectedSectionId: pinPickerState.expectedSectionId,
              realSectionId,
            });
            setPinPickerState(null);
          }}
          isPending={pinExpectedMut.isPending}
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

/* ═══════════════ PinPickerDialog ═══════════════ */

/**
 * Picker для перепривязки orphaned ExpectedSection. Эксперт видит список
 * реальных секций документа, выбирает нужную и нажимает «Привязать» —
 * вызывается `expectedSection.pin`, который снимает свежий anchor с этой
 * секции (occurrenceIndex + contentBlockDigest), чтобы re-parse её снова
 * нашёл.
 *
 * UX: фильтр по подстроке title (с учётом дубликатов — показываем номер из
 * `numbering`, чтобы эксперт мог отличить «3.2 Цели» от «5.1 Цели»).
 */
function PinPickerDialog({
  sections,
  numbering,
  expectedTitle,
  onClose,
  onPick,
  isPending,
}: {
  sections: Section[];
  numbering: Map<string, string>;
  expectedTitle: string;
  onClose: () => void;
  onPick: (realSectionId: string) => void;
  isPending: boolean;
}) {
  const [filter, setFilter] = useState(expectedTitle);
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sections.filter((s) => !s.isFalseHeading);
    return sections.filter(
      (s) =>
        !s.isFalseHeading &&
        s.title.toLowerCase().includes(needle),
    );
  }, [sections, filter]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex w-full max-w-lg max-h-[80vh] flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Восстановить anchor</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Выберите секцию, к которой привязать эталон «{expectedTitle}»
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Фильтр по заголовку..."
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <div className="max-h-80 overflow-y-auto rounded border border-gray-200">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-xs italic text-gray-400">
                Нет секций, соответствующих фильтру.
              </p>
            ) : (
              filtered.map((s) => {
                const num = numbering.get(s.id);
                const isSel = selected === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelected(s.id)}
                    className={`flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left text-xs last:border-b-0 ${
                      isSel ? "bg-brand-50" : "hover:bg-gray-50"
                    }`}
                  >
                    {num && (
                      <span className="shrink-0 font-mono text-[10px] text-gray-400">
                        {num}
                      </span>
                    )}
                    <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] text-gray-600">
                      L{s.level}
                    </span>
                    <span className="flex-1 truncate text-gray-900">
                      {s.title || "(без названия)"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            onClick={() => selected && onPick(selected)}
            disabled={!selected || isPending}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Привязка...
              </span>
            ) : (
              "Привязать"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
