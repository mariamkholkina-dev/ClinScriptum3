"use client";

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Filter,
  Columns2,
  GitCompareArrows,
  CheckSquare,
  Square,
  Keyboard,
  X,
  HelpCircle,
  Edit3,
  Save,
  Search,
  CornerDownRight,
} from "lucide-react";

import type {
  Section,
  AnomalyType,
  DiffEntry,
  SortKey,
  FilterState,
  TaxonomyEntry,
} from "./types";
import { EMPTY_FILTERS } from "./types";
import {
  buildNumbering,
  detectAnomalies,
  sortSections,
  filterSections,
  diffClassificationWithExpected,
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
  classificationStatus: "По статусу",
  confidence: "По уверенности",
  algoSection: "По алгоритму",
  llmSection: "По LLM",
};

const ANOMALY_ICON_CLS: Record<AnomalyType, string> = {
  empty: "text-amber-500",
  orphaned: "text-red-500",
  duplicate_title: "text-orange-500",
  short: "text-yellow-600",
};

const CLASSIFIED_BY_LABEL: Record<string, string> = {
  deterministic: "Правило",
  llm_check: "LLM",
  llm_qa: "LLM QA",
};

/* ═══════════════ Helpers ═══════════════ */

/**
 * Группирует taxonomy-опции по родительской зоне и сортирует subzones алфавитно
 * внутри каждой группы. Возвращает <optgroup>'ы для использования в <select>.
 *
 * Структура `taxonomyOptions[i].value`:
 *   - zone: `"synopsis"`, `"design"`, ...
 *   - subzone: `"design.blinding_and_unblinding"`, `"ip.description"`, ...
 *
 * Если у zone нет subzones, выводится одна `<option>` без optgroup-обёртки
 * (чтобы не было пустой группы в выпадашке).
 */
function GroupedZoneOptions({
  options,
}: {
  options: Array<{ value: string; label: string; type: string }>;
}) {
  // Сортируем zones алфавитно по label.
  const zones = options
    .filter((o) => o.type === "zone")
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));

  return (
    <>
      {zones.map((zone) => {
        const subzones = options
          .filter((s) => s.type === "subzone" && s.value.startsWith(zone.value + "."))
          .slice()
          .sort((a, b) => a.label.localeCompare(b.label, "ru"));

        if (subzones.length === 0) {
          // Одинокая зона без subzones — без optgroup-обёртки, иначе будет
          // пустая группа в UI.
          return (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          );
        }

        return (
          <optgroup key={zone.value} label={zone.label}>
            <option value={zone.value}>{zone.label}</option>
            {subzones.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

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

/* ═══════════════ DiffOverlay ═══════════════ */

interface DiffOverlayProps {
  entries: DiffEntry[];
  /** Все секции — для маппинга entry.sectionTitle → sectionId. */
  sections: Section[];
  /** Опции taxonomy для inline-select правки. */
  taxonomyOptions: Array<{ value: string; label: string; type: string }>;
  /**
   * Quick-fix мутация. Логика по типу:
   *   - wrong_section: обновить Section.standardSection + upsert в expected_results
   *   - extra: добавить запись в expected_results (опционально изменить standardSection)
   *   - missing: удалить запись из expected_results (sectionId=null, newZone=null)
   */
  onQuickFix: (params: {
    diffType: DiffEntry["type"];
    sectionId: string | null;
    sectionTitle: string;
    newZone: string | null;
    /** Для wrong_section: исходное expected.standardSection из diff entry —
        используется для уникального матчинга записи в expected.sections при
        дубликатах title. Без этого findIndex по title находил случайную копию. */
    originalExpectedZone?: string | null;
    /** Позиционный индекс секции среди дубликатов title в реальном документе —
        используется для positional matching записи в expected.sections. */
    duplicateIndex?: number;
  }) => void;
  /** Прыжок к строке в основной структуре: фокус + scroll. */
  onJumpToSection: (sectionId: string) => void;
  /** Идёт ли мутация — для disable кнопок. */
  fixPending: boolean;
}

function ClassificationDiffOverlay({
  entries,
  sections,
  taxonomyOptions,
  onQuickFix,
  onJumpToSection,
  fixPending,
}: DiffOverlayProps) {
  // Resolve real-секцию для строки overlay: приоритет — по actualSectionId
  // (точно при дубликатах title), fallback — по title (старые entries без id).
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

  // Локальный state per-row select — initial value по типу:
  //   wrong_section: expected.standardSection (предложение эксперта)
  //   extra: actual.standardSection (предлагаем принять как есть)
  //   missing: expected.standardSection (что эксперт изначально ожидал)
  const [pendingZones, setPendingZones] = useState<Map<string, string>>(new Map());

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
        Классификация полностью совпадает с эталоном.
      </div>
    );
  }

  const missing = entries.filter((e) => e.type === "missing");
  const extra = entries.filter((e) => e.type === "extra");
  const wrongSection = entries.filter((e) => e.type === "wrong_section");

  const getRowKey = (e: DiffEntry, idx: number) => `${e.type}:${e.sectionTitle}:${idx}`;

  // Дефолтное предложение для select — то что эксперту скорее всего захочется применить.
  const getSuggestedZone = (e: DiffEntry, matched: Section | undefined): string => {
    if (e.type === "wrong_section") return e.expected?.standardSection ?? matched?.standardSection ?? "";
    if (e.type === "extra") return e.actual?.standardSection ?? matched?.standardSection ?? "";
    /* missing */ return e.expected?.standardSection ?? "";
  };

  // Подпись и tooltip кнопки «Применить» зависят от типа entry.
  const getApplyLabel = (e: DiffEntry): { label: string; title: string } => {
    if (e.type === "wrong_section") return { label: "Применить", title: "Обновить Section.standardSection и эталон" };
    if (e.type === "extra") return { label: "Принять в эталон", title: "Добавить эту секцию в expected_results JSON" };
    /* missing */ return { label: "Удалить из эталона", title: "Удалить запись из expected_results JSON" };
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-xs font-medium">
        <span className="rounded bg-red-100 px-2 py-1 text-red-700">Пропущено: {missing.length}</span>
        <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">Лишних: {extra.length}</span>
        <span className="rounded bg-purple-100 px-2 py-1 text-purple-700">Неверная секция: {wrongSection.length}</span>
      </div>

      <div className="max-h-80 overflow-y-auto space-y-1.5">
        {entries.map((e, i) => {
          const rowKey = getRowKey(e, i);
          const matchedSection = resolveSection(e);
          const suggestedZone = getSuggestedZone(e, matchedSection);
          const currentValue = pendingZones.get(rowKey) ?? suggestedZone;
          const applyMeta = getApplyLabel(e);
          // Для missing select-editor не нужен (нечего выбирать — мы удаляем запись из эталона).
          // Для extra/wrong_section — select предлагает варианты, кнопка всегда активна.
          const showSelect = e.type !== "missing";

          // Цепочка родителей для контекста (extra/wrong_section — берём из реальной
          // секции; missing — секция в документе отсутствует, breadcrumb недоступен).
          const parentChain = matchedSection ? getParentChain(matchedSection.id, sections) : [];
          const parentBreadcrumb = parentChain.length > 0
            ? parentChain.map((p) => p.title || "(без названия)").join(" › ")
            : null;

          return (
            <div
              key={rowKey}
              className={`rounded-md border px-3 py-2 text-xs ${
                e.type === "missing"
                  ? "border-red-200 bg-red-50"
                  : e.type === "extra"
                    ? "border-amber-200 bg-amber-50"
                    : "border-purple-200 bg-purple-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {parentBreadcrumb && (
                    <div className="mb-0.5 truncate text-[10px] text-gray-500" title={parentBreadcrumb}>
                      {parentBreadcrumb}
                    </div>
                  )}
                  <span
                    className={`font-medium ${
                      e.type === "missing"
                        ? "text-red-700"
                        : e.type === "extra"
                          ? "text-amber-700"
                          : "text-purple-700"
                    }`}
                  >
                    {e.type === "missing" ? "Пропущено" : e.type === "extra" ? "Лишняя" : "Неверная секция"}
                  </span>
                  <span className="ml-1 text-gray-900" title={e.sectionTitle}>
                    {e.sectionTitle}
                  </span>
                  {e.type === "wrong_section" && e.expected && e.actual && (
                    <div className="mt-0.5 text-gray-500">
                      ожидалось «{e.expected.standardSection ?? "—"}», получено «{e.actual.standardSection ?? "—"}»
                    </div>
                  )}
                  {e.type === "extra" && e.actual && (
                    <div className="mt-0.5 text-gray-500">
                      получено «{e.actual.standardSection ?? "—"}» (нет в эталоне)
                    </div>
                  )}
                  {e.type === "missing" && e.expected && (
                    <div className="mt-0.5 text-gray-500">
                      ожидалось «{e.expected.standardSection ?? "—"}» (нет в документе)
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

              <div className="mt-2 flex items-center gap-1.5">
                {showSelect && (
                  <select
                    value={currentValue}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      setPendingZones((prev) => {
                        const next = new Map(prev);
                        next.set(rowKey, v);
                        return next;
                      });
                    }}
                    className="flex-1 min-w-0 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs"
                  >
                    <option value="">— null —</option>
                    <GroupedZoneOptions options={taxonomyOptions} />
                  </select>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onQuickFix({
                      diffType: e.type,
                      sectionId: matchedSection?.id ?? null,
                      sectionTitle: e.sectionTitle,
                      newZone: e.type === "missing" ? null : (currentValue === "" ? null : currentValue),
                      originalExpectedZone: e.expected?.standardSection ?? null,
                      duplicateIndex: e.duplicateIndex,
                    })
                  }
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium text-white ${
                    e.type === "missing" ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
                  }`}
                  title={applyMeta.title}
                >
                  {applyMeta.label}
                </button>
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

/* ═══════════════ TaxonomyHelpDialog ═══════════════ */

function TaxonomyHelpDialog({
  taxonomy,
  onClose,
}: {
  taxonomy: TaxonomyEntry[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const searchLower = search.toLowerCase();

  const zones = useMemo(() => {
    const zoneMap = new Map<string, { zone: TaxonomyEntry; subzones: TaxonomyEntry[] }>();
    for (const t of taxonomy) {
      const cfg = t.config as TaxonomyEntry["config"];
      if (cfg.type === "zone") {
        if (!zoneMap.has(cfg.key)) {
          zoneMap.set(cfg.key, { zone: t, subzones: [] });
        } else {
          zoneMap.get(cfg.key)!.zone = t;
        }
      }
    }
    for (const t of taxonomy) {
      const cfg = t.config as TaxonomyEntry["config"];
      if (cfg.type === "subzone" && cfg.parentZone) {
        const parent = zoneMap.get(cfg.parentZone);
        if (parent) parent.subzones.push(t);
      }
    }
    return Array.from(zoneMap.values());
  }, [taxonomy]);

  const filtered = useMemo(() => {
    if (!search) return zones;
    return zones.filter((z) => {
      const zCfg = z.zone.config as TaxonomyEntry["config"];
      if (zCfg.titleRu.toLowerCase().includes(searchLower) || z.zone.pattern.toLowerCase().includes(searchLower)) return true;
      return z.subzones.some((s) => {
        const sCfg = s.config as TaxonomyEntry["config"];
        return sCfg.titleRu.toLowerCase().includes(searchLower) || s.pattern.toLowerCase().includes(searchLower);
      });
    });
  }, [zones, search, searchLower]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">Справочник секций</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 pt-4 pb-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск секций..."
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Ничего не найдено</p>
          ) : (
            <div className="space-y-4">
              {filtered.map((z) => {
                const zCfg = z.zone.config as TaxonomyEntry["config"];
                return (
                  <div key={z.zone.pattern} className="rounded-md border border-gray-200 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="rounded bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
                        {z.zone.pattern}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{zCfg.titleRu}</span>
                    </div>
                    {z.subzones.length > 0 && (
                      <div className="ml-4 space-y-1">
                        {z.subzones.map((s) => {
                          const sCfg = s.config as TaxonomyEntry["config"];
                          return (
                            <div key={s.pattern} className="flex items-center gap-2 text-xs">
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600">
                                {s.pattern}
                              </span>
                              <span className="text-gray-700">{sCfg.titleRu}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ ClassificationToolbar ═══════════════ */

function ClassificationToolbar({
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
  onShowHelp,
  bulkPending,
  annotateHref,
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
  onShowHelp: () => void;
  bulkPending: boolean;
  annotateHref?: string;
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

        {/* Help */}
        <button
          onClick={onShowHelp}
          className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          <HelpCircle size={12} /> Справочник
        </button>

        {/* Annotate */}
        {annotateHref && (
          <Link
            href={annotateHref}
            className="flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            <Edit3 size={12} /> Разметить →
          </Link>
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
          value={filters.classificationStatus}
          onChange={(e) => onFiltersChange({ ...filters, classificationStatus: e.target.value as FilterState["classificationStatus"] })}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Статус: все</option>
          <option value="validated">Подтверждён</option>
          <option value="not_validated">Не подтверждён</option>
          <option value="requires_rework">На доработку</option>
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

        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.disagreement}
            onChange={(e) => onFiltersChange({ ...filters, disagreement: e.target.checked })}
            className="rounded border-gray-300"
          />
          Расхождение алго/LLM
        </label>

        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.agreement}
            onChange={(e) => onFiltersChange({ ...filters, agreement: e.target.checked })}
            className="rounded border-gray-300"
          />
          Совпадение алго/LLM/итог
        </label>

        {(filters.classificationStatus || filters.level || filters.hasContent || filters.anomaliesOnly || filters.disagreement || filters.agreement) && (
          <button
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="text-xs text-brand-600 hover:text-brand-700"
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Row 3: Bulk actions */}
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

/* ═══════════════ SectionClassificationEditor ═══════════════ */

function SectionClassificationEditor({
  section,
  taxonomyOptions,
  onSave,
  onCancel,
  isPending,
}: {
  section: Section;
  taxonomyOptions: { value: string; label: string; type: string }[];
  onSave: (standardSection: string | null) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [selected, setSelected] = useState(section.standardSection ?? "");

  return (
    <div className="flex items-center gap-2 bg-white border border-brand-200 rounded-md px-3 py-2 ml-8 mr-4 mb-1"
      onClick={(e) => e.stopPropagation()}
    >
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
      >
        <option value="">— Не определена —</option>
        <GroupedZoneOptions options={taxonomyOptions} />
      </select>
      <button
        onClick={() => onSave(selected || null)}
        disabled={isPending}
        className="flex items-center gap-1 rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
        Сохранить
      </button>
      <button
        onClick={onCancel}
        className="text-xs text-gray-500 hover:text-gray-700"
      >
        <X size={14} />
      </button>
    </div>
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
  isEditing,
  taxonomyOptions,
  onToggleCollapse,
  onToggleExpand,
  onToggleSelect,
  onStartEdit,
  onSaveClassification,
  onCancelEdit,
  classificationPending,
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
  isEditing: boolean;
  taxonomyOptions: { value: string; label: string; type: string }[];
  onToggleCollapse: () => void;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onSaveClassification: (standardSection: string | null) => void;
  onCancelEdit: () => void;
  classificationPending: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
}) {
  const isFalse = section.isFalseHeading;
  const diffBg = isFalse
    ? "bg-gray-100/70"
    : diffType === "extra"
      ? "bg-amber-50/60"
      : diffType === "wrong_section"
        ? "bg-purple-50/60"
        : "";
  const disagreement = section.algoSection !== section.llmSection && section.algoSection != null && section.llmSection != null;

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

        {/* Collapse arrow */}
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
        <span className="shrink-0 font-mono text-xs text-gray-400 w-12 text-right">
          {numbering}
        </span>

        {/* Title */}
        <span
          className={`flex-1 min-w-0 truncate text-sm font-medium ${isFalse ? "text-gray-400 line-through" : "text-gray-900"}`}
          title={section.title || "(без названия)"}
        >
          {section.title || "(без названия)"}
        </span>

        {/* False-heading badge (помечено в Парсинге) */}
        {isFalse && (
          <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700" title="Помечено как ложный заголовок в Парсинге — исключено из diff">
            Не заголовок
          </span>
        )}

        {/* Anomaly icons */}
        {anomalies.map((a) => (
          <span key={a} title={ANOMALY_LABELS[a]} className={`shrink-0 ${ANOMALY_ICON_CLS[a]}`}>
            <AlertTriangle size={13} />
          </span>
        ))}

        {/* Algo classification */}
        <span className="shrink-0 flex items-center gap-1" title="Алгоритм">
          {section.algoSection ? (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-700 ${disagreement ? "ring-1 ring-amber-400" : ""}`}>
              А: {section.algoSection}
            </span>
          ) : (
            <span className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 bg-gray-50">А: —</span>
          )}
          {section.algoConfidence != null && section.algoConfidence > 0 && (
            <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${CONFIDENCE_COLOR(section.algoConfidence)}`}>
              {Math.round(section.algoConfidence * 100)}%
            </span>
          )}
        </span>

        {/* LLM classification */}
        <span className="shrink-0 flex items-center gap-1" title="LLM">
          {section.llmSection ? (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-50 text-violet-700 ${disagreement ? "ring-1 ring-amber-400" : ""}`}>
              L: {section.llmSection}
            </span>
          ) : (
            <span className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 bg-gray-50">L: —</span>
          )}
          {section.llmConfidence != null && section.llmConfidence > 0 && (
            <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${CONFIDENCE_COLOR(section.llmConfidence)}`}>
              {Math.round(section.llmConfidence * 100)}%
            </span>
          )}
        </span>

        {/* Final result */}
        <span className="shrink-0 flex items-center gap-1" title="Итог">
          {section.standardSection ? (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-brand-100 text-brand-700">
              {section.standardSection}
            </span>
          ) : (
            <span className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 bg-gray-50">—</span>
          )}
          {section.confidence != null && (
            <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${CONFIDENCE_COLOR(section.confidence)}`}>
              {Math.round(section.confidence * 100)}%
            </span>
          )}
          {section.classifiedBy && (
            <span className="text-[9px] text-gray-400">
              {CLASSIFIED_BY_LABEL[section.classifiedBy] ?? section.classifiedBy}
            </span>
          )}
        </span>

        {/* Classification status */}
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLS[section.classificationStatus] ?? ""}`}>
          {STATUS_LABEL[section.classificationStatus] ?? section.classificationStatus}
        </span>

        {/* Block count */}
        <span className="shrink-0 text-[10px] text-gray-400 w-8 text-right">
          {section.contentBlocks.length} бл.
        </span>

        {/* Edit button */}
        <button
          onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
          className="shrink-0 text-gray-400 hover:text-brand-600"
          title="Назначить секцию"
        >
          <Edit3 size={13} />
        </button>

        {/* Expand indicator */}
        <ChevronDown
          size={13}
          className={`shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </div>

      {/* Classification editor */}
      {isEditing && (
        <SectionClassificationEditor
          section={section}
          taxonomyOptions={taxonomyOptions}
          onSave={onSaveClassification}
          onCancel={onCancelEdit}
          isPending={classificationPending}
        />
      )}

      {/* Expanded content */}
      {isExpanded && <ContentBlockPanel blocks={section.contentBlocks} />}
    </div>
  );
}

/* ═══════════════ Main Component ═══════════════ */

export default function ClassificationTreeViewer({
  versionId,
  expectedResults,
  goldenSampleId,
  stageKey = "classification",
  stageStatus = "draft",
}: {
  versionId: string;
  expectedResults?: unknown;
  /** Опционально (раньше viewer использовался без golden-sample context) — нужен для quick-fix
      обновления expected_results JSON. Если не передан — quick-fix меняет только Section. */
  goldenSampleId?: string;
  stageKey?: string;
  stageStatus?: string;
}) {
  const q = trpc.document.getVersion.useQuery(
    { versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const taxonomyQuery = trpc.document.getTaxonomy.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);

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
    () => (showDiff ? diffClassificationWithExpected(rawSections, expectedResults) : []),
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

  const taxonomyOptions = useMemo(() => {
    if (!taxonomyQuery.data) return [];
    return taxonomyQuery.data.map((r: Record<string, unknown>) => ({
      value: r.pattern as string,
      label: `${(r.config as Record<string, unknown>).titleRu} (${r.pattern})`,
      type: (r.config as Record<string, unknown>).type as string,
    }));
  }, [taxonomyQuery.data]);

  // Bulk classification status update
  const utils = trpc.useUtils();
  const bulkClassificationMutation = trpc.processing.bulkUpdateSectionClassificationStatus.useMutation({
    onSuccess: () => {
      utils.document.getVersion.invalidate({ versionId });
      setSelectedIds(new Set());
    },
  });

  const bulkUpdate = useCallback(
    (status: "validated" | "requires_rework", classificationComment?: string) => {
      bulkClassificationMutation.mutate({
        sectionIds: Array.from(selectedIds),
        status,
        ...(classificationComment ? { classificationComment } : {}),
      });
    },
    [selectedIds, bulkClassificationMutation],
  );

  // Individual classification update
  // Optimistic update: правка standardSection отражается в кеше getVersion сразу.
  // Invalidate только на onError (та же логика что в parsing-viewer — refetch после
  // быстрых параллельных кликов мог перезаписывать кеш данными до применения мутаций).
  const updateClassification = trpc.document.updateSectionClassification.useMutation({
    onMutate: async ({ sectionId, standardSection, classificationStatus }) => {
      await utils.document.getVersion.cancel({ versionId });
      const prev = utils.document.getVersion.getData({ versionId });
      utils.document.getVersion.setData({ versionId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          sections: old.sections.map((s) =>
            s.id === sectionId
              ? {
                  ...s,
                  standardSection,
                  ...(classificationStatus
                    ? { classificationStatus: classificationStatus as typeof s.classificationStatus }
                    : {}),
                }
              : s,
          ),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.document.getVersion.setData({ versionId }, ctx.prev);
      utils.document.getVersion.invalidate({ versionId });
    },
    onSuccess: () => {
      setEditingSectionId(null);
    },
  });

  const handleSaveClassification = useCallback(
    (sectionId: string, standardSection: string | null) => {
      updateClassification.mutate({
        sectionId,
        standardSection,
        classificationStatus: "validated",
      });
    },
    [updateClassification],
  );

  // Мутация обновления expected_results JSON (для extra/missing в diff overlay).
  // Используется когда нужно добавить/изменить/удалить запись секции в эталоне,
  // а не только её standardSection в БД.
  // Optimistic update для эталона: патч goldenDataset.getSample в кеше,
  // родительский page.tsx через useQuery подхватит свежий expectedResults.
  // Invalidate только на onError (см. parsing-viewer для подробностей race-fix'а).
  const updateExpected = trpc.goldenDataset.updateStageStatus.useMutation({
    onMutate: async (input) => {
      if (!goldenSampleId) return undefined;
      await utils.goldenDataset.getSample.cancel({ id: goldenSampleId });
      const prev = utils.goldenDataset.getSample.getData({ id: goldenSampleId });
      utils.goldenDataset.getSample.setData({ id: goldenSampleId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          stageStatuses: old.stageStatuses.map((ss) =>
            ss.stage === input.stage
              ? {
                  ...ss,
                  expectedResults: (input.expectedResults ?? {}) as typeof ss.expectedResults,
                  status: input.status as typeof ss.status,
                }
              : ss,
          ),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev && goldenSampleId) {
        utils.goldenDataset.getSample.setData({ id: goldenSampleId }, ctx.prev);
        utils.goldenDataset.getSample.invalidate({ id: goldenSampleId });
      }
    },
  });

  // Quick-fix для строки diff overlay. Принимает sectionId (если есть в БД),
  // sectionTitle и newZone. Логика по типу entry:
  //  - extra: section в БД, нет в expected → upsert в expected.sections[*]
  //  - wrong_section: есть в обоих, разные zone → updateClassification (Section)
  //                   + upsert в expected (чтобы не появился extra)
  //  - missing: нет в БД, есть в expected → удалить из expected
  const handleQuickFix = useCallback(
    (params: {
      diffType: DiffEntry["type"];
      sectionId: string | null;
      sectionTitle: string;
      newZone: string | null;
      originalExpectedZone?: string | null;
      duplicateIndex?: number;
    }) => {
      const { diffType, sectionId, sectionTitle, newZone, originalExpectedZone, duplicateIndex } = params;

      // 1) Update Section.standardSection (если есть section и тип — wrong_section/extra)
      if (sectionId && diffType !== "missing" && newZone !== null) {
        updateClassification.mutate({
          sectionId,
          standardSection: newZone,
          classificationStatus: "validated",
        });
      }

      // 2) Update expected_results JSON (если есть golden-sample context)
      if (!goldenSampleId) return;

      const current = (expectedResults as { sections?: Array<Record<string, unknown>> } | undefined) ?? {};
      const sectionsArr = Array.isArray(current.sections) ? [...current.sections] : [];
      const titleLower = sectionTitle.trim().toLowerCase();

      let nextSections: Array<Record<string, unknown>>;

      if (diffType === "missing") {
        // Удаляем первую запись с этим title (missing — в реальности секции нет,
        // и matched строго по порядку в diff, поэтому удаляем тоже первую).
        const idx = sectionsArr.findIndex(
          (s) => String(s.title ?? "").trim().toLowerCase() === titleLower,
        );
        if (idx < 0) return;
        nextSections = sectionsArr.filter((_, i) => i !== idx);
      } else if (diffType === "wrong_section") {
        // Positional match: ищем (duplicateIndex+1)-ю запись с таким title в expected.
        // diff matches positionally — n-я real-секция с title T сопоставляется
        // с n-й expected записью с этим же title. Обновляем именно её.
        // Fallback: если duplicateIndex не передан или записей меньше —
        // ищем по title + старый standardSection.
        let idx = -1;
        if (typeof duplicateIndex === "number") {
          let seen = 0;
          for (let i = 0; i < sectionsArr.length; i++) {
            if (String(sectionsArr[i].title ?? "").trim().toLowerCase() === titleLower) {
              if (seen === duplicateIndex) { idx = i; break; }
              seen++;
            }
          }
        }
        if (idx < 0) {
          idx = sectionsArr.findIndex(
            (s) =>
              String(s.title ?? "").trim().toLowerCase() === titleLower &&
              (s.standardSection ?? null) === (originalExpectedZone ?? null),
          );
        }
        if (idx >= 0) {
          nextSections = sectionsArr.map((s, i) =>
            i === idx ? { ...s, title: sectionTitle, standardSection: newZone } : s,
          );
        } else {
          nextSections = [...sectionsArr, { title: sectionTitle, standardSection: newZone }];
        }
      } else {
        // diffType === "extra" — секция реально есть в документе, но не была в эталоне.
        // Всегда push новой записи. Так как diff делает positional matching, новая
        // запись займёт позицию (n+1) среди дубликатов и будет matched с этой extra
        // секцией на следующем рендере → строка пропадёт из overlay.
        nextSections = [...sectionsArr, { title: sectionTitle, standardSection: newZone }];
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
    [
      updateClassification,
      updateExpected,
      expectedResults,
      goldenSampleId,
      stageKey,
      stageStatus,
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

  useEffect(() => {
    focusedRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIdx]);

  // Синхронизация focusedIdx с activeSectionId. Используется кнопкой "Перейти"
  // в DiffOverlay: setActiveSectionId(id) сам по себе не двигает focusedIdx,
  // и scrollIntoView выше зависит от focusedIdx. Этот effect ловит изменение
  // activeSectionId и переустанавливает focusedIdx → scroll triggered.
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
        <span className="ml-2 text-sm text-gray-500">Загрузка классификации...</span>
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
      <ClassificationToolbar
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
        onSelectAll={() => setSelectedIds(new Set(visibleSections.map((s) => s.id)))}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        showDiff={showDiff}
        onToggleDiff={() => setShowDiff((p) => !p)}
        hasDiffData={hasDiffData}
        showSource={showSource}
        onToggleSource={() => setShowSource((p) => !p)}
        onShowHelp={() => setShowHelp(true)}
        bulkPending={bulkClassificationMutation.isPending}
        annotateHref={goldenSampleId ? `/annotate/${goldenSampleId}/${stageKey}` : undefined}
      />

      {/* Diff results */}
      {showDiff && (
        <ClassificationDiffOverlay
          entries={diffEntries}
          sections={rawSections}
          taxonomyOptions={taxonomyOptions}
          onQuickFix={(params) => handleQuickFix(params)}
          onJumpToSection={(sectionId) => {
            // 1. Снимаем фильтры — иначе целевая строка может быть отфильтрована
            //    и focusedRowRef не обнаружит её для scrollIntoView.
            setFilters(EMPTY_FILTERS);
            // 2. Раскрываем всех parent'ов чтобы строка стала видимой.
            setCollapsedIds(new Set());
            // 3. Активируем секцию — useEffect c focusedIdx сделает scrollIntoView.
            setActiveSectionId(sectionId);
            // 4. Фокусируемся на tree-контейнер для keyboard nav.
            requestAnimationFrame(() => containerRef.current?.focus());
          }}
          fixPending={updateClassification.isPending || updateExpected.isPending}
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
                  isEditing={editingSectionId === s.id}
                  taxonomyOptions={taxonomyOptions}
                  onToggleCollapse={() => toggleCollapse(s.id)}
                  onToggleExpand={() => toggleExpand(s.id)}
                  onToggleSelect={() => toggleSelect(s.id)}
                  onStartEdit={() => setEditingSectionId(s.id)}
                  onSaveClassification={(standardSection) => handleSaveClassification(s.id, standardSection)}
                  onCancelEdit={() => setEditingSectionId(null)}
                  classificationPending={updateClassification.isPending}
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

      {/* Taxonomy help dialog */}
      {showHelp && taxonomyQuery.data && (
        <TaxonomyHelpDialog
          taxonomy={taxonomyQuery.data as TaxonomyEntry[]}
          onClose={() => setShowHelp(false)}
        />
      )}
    </div>
  );
}
